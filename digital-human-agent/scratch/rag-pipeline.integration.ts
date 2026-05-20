import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { KnowledgeContentService } from '@/knowledge-content/services/manage/knowledge-content.service';
import { KnowledgeSearchService } from '@/knowledge-content/services/retrieval/knowledge-search.service';
import { ContentRuntimeService } from '@/knowledge/services/manage/content-runtime.service';

function readDotEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync('.env')) return env;

  const raw = readFileSync('.env', 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = stripQuotes(match[2].trim());
  }
  return env;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

const fileEnv = readDotEnv();
for (const [key, value] of Object.entries(fileEnv)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

async function main() {
  console.log('=== [RAG Integration Test] Starting Nest Application Context ===');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  let targetKnowledgeId: string | null = null;
  let ingestedDocId: string | null = null;

  try {
    const contentService = app.get(KnowledgeContentService);
    const searchService = app.get(KnowledgeSearchService);
    const runtime = app.get(ContentRuntimeService);

    // 1. 从 supabase 获取一个现有的知识库，用以挂载测试文档
    const { data: kbList, error: kbError } = await runtime.supabase
      .from('knowledge_base')
      .select('id')
      .limit(1);

    if (kbError || !kbList || kbList.length === 0 || !kbList[0]?.id) {
      throw new Error('未在数据库中找到任何可用的知识库，请先在系统中创建一个知识库');
    }

    const targetKbId = kbList[0].id as string;
    console.log(`[RAG Integration Test] 找到目标测试知识库 ID: ${targetKbId}`);

    // 2. 模拟文档数据导入 (包括文档切片、嵌入生成、PG入库、ES与Neo4j同步)
    const testFileName = `test-integration-${Date.now()}.md`;
    const testContent = [
      '# 反重力测试文档',
      '',
      '反重力智能体项目是由 Google DeepMind 高级代理人编码团队研发的。',
      '',
      '## 核心功能说明',
      '',
      '该智能体支持快速的代码重构、完善的类型定义以及全链 RAG 链路优化功能。',
    ].join('\n');

    console.log(`[RAG Integration Test] 开始导入测试文档: ${testFileName}`);
    const doc = await contentService.ingestDocument(targetKbId, testFileName, testContent, {
      category: 'integration-test',
    });
    ingestedDocId = doc.id;
    console.log(`[RAG Integration Test] 文档导入成功，生成的 Document ID 为: ${ingestedDocId}, 状态: ${doc.status}`);

    // 3. 执行混合检索 (Stage1 + Stage2 全流程测试)
    const testQuery = 'Google DeepMind 的反重力智能体有哪些核心功能？';
    console.log(`[RAG Integration Test] 开始执行端到端检索，检索词为: "${testQuery}"`);
    
    const retrieveResult = await contentService.retrieveWithStages(targetKbId, testQuery, {
      rerank: true,
      stage1TopK: 5,
      finalTopK: 3,
    });

    console.log('=== [RAG Integration Test] 检索结果返回 ===');
    console.log(`Stage 1 召回总数: ${retrieveResult.stage1.length}`);
    console.log(`Stage 2 重排后结果数量: ${retrieveResult.stage2.length}`);

    if (retrieveResult.stage2.length > 0) {
      console.log('首条召回文本:', retrieveResult.stage2[0].content);
      console.log('召回相似度分数:', retrieveResult.stage2[0].similarity);
      console.log('重排打分:', retrieveResult.stage2[0].rerank_score);
    }

    // 校验召回合理性
    const isPassed = retrieveResult.stage1.length > 0;
    if (isPassed) {
      console.log('\n✅ ✅ ✅ [RAG Integration Test] Pipeline integration test PASSED! ✅ ✅ ✅\n');
    } else {
      throw new Error('未召回任何相关 Chunks，请检查 Embedding 或 ES 别名设置。');
    }

  } catch (error) {
    console.error('\n❌ ❌ ❌ [RAG Integration Test] Pipeline integration test FAILED! ❌ ❌ ❌');
    console.error(error);
    process.exitCode = 1;
  } finally {
    // 4. 清理脏数据，移除我们添加的临时测试文档
    if (ingestedDocId) {
      console.log(`[RAG Integration Test] 正在清理测试产生的 Document (ID: ${ingestedDocId})...`);
      const contentService = app.get(KnowledgeContentService);
      await contentService.deleteDocument(ingestedDocId).catch((err) => {
        console.error('清理文档失败', err);
      });
      console.log('[RAG Integration Test] 测试文档清理完毕。');
    }
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
