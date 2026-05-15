#!/usr/bin/env node
/**
 * RAG 语义缓存回退脚本
 *
 * 默认 dry-run，只输出将执行的 SQL 文件和连接形态。
 * 真正执行回退必须显式传入 --yes。
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

applyDotEnvDefaults(path.join(__dirname, '../.env'));

const ROLLBACK_FILE = path.join(
  __dirname,
  '../supabase/rollbacks/009_rag_semantic_cache.rollback.sql',
);

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

async function main() {
  const dryRun = !hasFlag('yes');
  const databaseUrl = String(process.env.DIRECT_URL || '').trim();
  if (!databaseUrl) {
    throw new Error('DIRECT_URL 为空，无法执行 RAG 语义缓存回退');
  }

  const sql = fs.readFileSync(ROLLBACK_FILE, 'utf8');
  const connectionWarnings = buildDirectUrlWarnings(databaseUrl);
  const report = {
    action: 'rollback-rag-semantic-cache',
    dryRun,
    rollbackFile: path.relative(process.cwd(), ROLLBACK_FILE),
    database: redactDatabaseUrl(databaseUrl),
    warnings: connectionWarnings,
    statements: [
      'DROP FUNCTION IF EXISTS match_rag_semantic_cache(...)',
      'DROP TABLE IF EXISTS rag_semantic_cache',
    ],
  };

  if (dryRun) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  for (const warning of connectionWarnings) {
    console.warn(`RAG 语义缓存回退连接警告：${warning}`);
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });

  try {
    await client.connect();
    await client.query(sql);
    console.log(
      JSON.stringify(
        {
          ...report,
          dryRun: false,
          status: 'applied',
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(
    `RAG 语义缓存回退失败：${redactRuntimeDiagnostic(error)}`,
  );
  process.exit(1);
});

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
      (_match, projectRef) =>
        `db.${maskIdentifier(projectRef)}.supabase.co`,
    )
    .replace(
      /(^|[^.\w-])([A-Za-z0-9_-]+)\.supabase\.co\b/g,
      (_match, prefix, projectRef) =>
        `${prefix}${maskIdentifier(projectRef)}.supabase.co`,
    );
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
    return ['DIRECT_URL 不是合法 URL，真实回退会失败。'];
  }
}
