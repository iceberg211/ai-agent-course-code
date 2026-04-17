#!/usr/bin/env node
/**
 * 数据库初始化脚本
 * 用法：npm run db:migrate
 *
 * 使用 DIRECT_URL（直连，不走 pgbouncer）执行 SQL migration 文件
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// 加载 .env
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const MIGRATION_DIR = path.join(__dirname, '../supabase/migrations');
const MIGRATIONS = [
  '001_init.sql',
  '002_rpc.sql',
  '003_knowledge_base.sql',
  '004_migrate_documents.sql',
  '005_knowledge_chunk.sql',
  '006_rpc_rewrite.sql',
];

async function migrate() {
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error('❌ DIRECT_URL is not set in .env');
    process.exit(1);
  }

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    for (const file of MIGRATIONS) {
      const filePath = path.join(MIGRATION_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      console.log(`⏳ Running ${file}...`);
      try {
        await client.query(sql);
        console.log(`✅ ${file} done\n`);
      } catch (err) {
        // 表已存在是幂等场景，跳过该文件继续
        if (err.code === '42P07') {
          console.log(`⚠️  ${file} skipped (tables already exist)\n`);
          continue;
        }
        throw err;
      }
    }

    console.log('🎉 All migrations completed successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
