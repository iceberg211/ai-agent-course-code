#!/usr/bin/env node
/**
 * 数据库初始化脚本
 * 用法：
 *   pnpm db:migrate -- --dry-run
 *   pnpm db:migrate
 *
 * 使用 DIRECT_URL（直连，不走 pgbouncer）执行 SQL migration 文件
 * 默认执行前建议先 dry-run，确认文件列表和连接形态。
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// 加载 .env，避免数据库脚本依赖额外 npm 包；命令行环境变量优先。
applyDotEnvDefaults(path.join(__dirname, '../.env'));

const MIGRATION_DIR = path.join(__dirname, '../supabase/migrations');
const MIGRATIONS = [
  '001_init.sql',
  '002_rpc.sql',
  '003_knowledge_base.sql',
  '004_migrate_documents.sql',
  '005_knowledge_chunk.sql',
  '006_rpc_rewrite.sql',
  '007_drop_legacy_shim.sql',
  '008_keyword_retrieval_index.sql',
  '012_rag_parent_child_index.sql',
  '014_knowledge_document_graph_sync_status.sql',
];

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const env = {};
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = stripQuotes(match[2].trim());
  }
  return env;
}

function applyDotEnvDefaults(filePath) {
  const env = readDotEnv(filePath);
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

async function migrate() {
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error('DIRECT_URL 为空，无法执行数据库 migration');
    process.exit(1);
  }

  const migrationFiles = MIGRATIONS.map((file) => {
    const filePath = path.join(MIGRATION_DIR, file);
    return {
      file,
      path: path.relative(process.cwd(), filePath),
      exists: fs.existsSync(filePath),
    };
  });
  const missingFiles = migrationFiles.filter((item) => !item.exists);
  const dryRun = hasFlag('dry-run');
  const connectionWarnings = buildDirectUrlWarnings(url);

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          action: 'db-migrate',
          dryRun: true,
          database: redactDatabaseUrl(url),
          migrations: migrationFiles,
          ready: missingFiles.length === 0,
          refusalReasons: missingFiles.map(
            (item) => `migration 文件不存在：${item.file}`,
          ),
          warnings: connectionWarnings,
        },
        null,
        2,
      ),
    );
    process.exit(missingFiles.length === 0 ? 0 : 1);
  }

  if (missingFiles.length > 0) {
    console.error(
      `数据库 migration 文件缺失：${missingFiles
        .map((item) => item.file)
        .join(', ')}`,
    );
    process.exit(1);
  }

  for (const warning of connectionWarnings) {
    console.warn(`数据库 migration 连接警告：${warning}`);
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('已连接数据库\n');

    for (const file of MIGRATIONS) {
      const filePath = path.join(MIGRATION_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      console.log(`执行 ${file}...`);
      try {
        await client.query(sql);
        console.log(`${file} 完成\n`);
      } catch (err) {
        // 幂等跳过：
        //   42P07 = duplicate_table (表已存在)
        //   42P13 = invalid_function_definition (函数签名已变更，无法 CREATE OR REPLACE)
        //   42723 = duplicate_function (函数已存在)
        if (
          err.code === '42P07' ||
          err.code === '42P13' ||
          err.code === '42723'
        ) {
          console.log(`${file} 已存在，跳过\n`);
          continue;
        }
        throw err;
      }
    }

    console.log('所有 migration 执行完成');
  } catch (err) {
    console.error('数据库 migration 失败:', redactRuntimeDiagnostic(err));
    process.exit(1);
  } finally {
    await client.end();
  }
}

function redactDatabaseUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return {
      protocol: url.protocol,
      host: redactSupabaseHostname(url.hostname),
      port: url.port || null,
      database: url.pathname.replace(/^\//, '') || null,
      username: maskIdentifier(decodeURIComponent(url.username)),
      hasPassword: Boolean(url.password),
      hasSearchParams: url.search.length > 0,
    };
  } catch {
    return { parseError: true };
  }
}

function buildDirectUrlWarnings(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname.endsWith('.pooler.supabase.com')) {
      return [
        'DIRECT_URL 当前仍指向 Supabase pooler；migration/backfill 排障建议使用 Dashboard Direct connection，host 形如 db.[PROJECT-REF].supabase.co。',
      ];
    }
    return [];
  } catch {
    return ['DIRECT_URL 不是合法 URL，真实 migration 会失败。'];
  }
}

function redactRuntimeDiagnostic(value) {
  const message = value instanceof Error ? value.message : String(value ?? '');
  return message
    .replace(
      /postgresql:\/\/([^:/@]+)(?::([^@]*))?@/gi,
      (_match, username) =>
        `postgresql://${maskIdentifier(decodeURIComponent(username))}:***@`,
    )
    .replace(/postgres\.[A-Za-z0-9_-]+/g, (username) =>
      maskIdentifier(username),
    )
    .replace(
      /\bdb\.([A-Za-z0-9_-]+)\.supabase\.co\b/g,
      (_match, projectRef) => `db.${maskIdentifier(projectRef)}.supabase.co`,
    )
    .replace(
      /(^|[^.\w-])([A-Za-z0-9_-]+)\.supabase\.co\b/g,
      (_match, prefix, projectRef) =>
        `${prefix}${maskIdentifier(projectRef)}.supabase.co`,
    );
}

function redactSupabaseHostname(hostname) {
  const directMatch = hostname.match(/^db\.([A-Za-z0-9_-]+)\.supabase\.co$/);
  if (directMatch) {
    return `db.${maskIdentifier(directMatch[1])}.supabase.co`;
  }

  const projectMatch = hostname.match(/^([A-Za-z0-9_-]+)\.supabase\.co$/);
  if (projectMatch) {
    return `${maskIdentifier(projectMatch[1])}.supabase.co`;
  }

  return hostname;
}

function maskIdentifier(value) {
  if (!value) return '';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

migrate();
