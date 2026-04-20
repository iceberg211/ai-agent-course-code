import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { KnowledgeService } from '../src/knowledge/knowledge.service';
import type { RagDebugTrace, RetrievalHit } from '../src/knowledge/rag-debug.types';
import { KnowledgeBaseService } from '../src/knowledge-base/knowledge-base.service';
import { PersonaService } from '../src/persona/persona.service';
import { seedEvalDataset } from './rag-seed-eval';

interface EvalCase {
  id: string;
  category: string;
  query: string;
  personaKey?: string;
  knowledgeBaseKeys?: string[];
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  expectedHitSelectors: HitSelector[];
  expectedAnswerPoints: string[];
  shouldTriggerFallback?: boolean;
  expectedLowConfidence?: boolean;
}

interface HitSelector {
  sourceName?: string;
  chunkIndex?: number;
  contentSha256?: string;
  contentIncludes?: string;
}

interface CaseResult {
  id: string;
  category: string;
  hitAt1: boolean;
  hitAt3: boolean;
  hitAt5: boolean;
  reciprocalRank: number;
  answerPointCoverage: number;
  lowConfidenceMatched: boolean;
  fallbackMatched: boolean;
  firstMatchRank: number | null;
  rerankDelta: number | null;
  traceId: string;
  langsmithRunId?: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function argValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const prefix = `${name}=`;
  const inline = args.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) {
    return args[index + 1];
  }
  return undefined;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function boolArg(name: string, defaultValue = false): boolean {
  const raw = argValue(name);
  if (raw === undefined) return hasArg(name) ? true : defaultValue;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function hitMatchesSelector(hit: RetrievalHit, selector: HitSelector): boolean {
  if (selector.sourceName && hit.sourceName !== selector.sourceName) return false;
  if (
    selector.chunkIndex !== undefined &&
    hit.chunkIndex !== selector.chunkIndex
  ) {
    return false;
  }
  if (
    selector.contentIncludes &&
    !hit.content.includes(selector.contentIncludes)
  ) {
    return false;
  }
  if (
    selector.contentSha256 &&
    !selector.contentSha256.includes('optional-seed-generated-hash') &&
    sha256(hit.content) !== selector.contentSha256
  ) {
    return false;
  }
  return true;
}

function firstMatchingHit(
  hits: RetrievalHit[],
  selectors: HitSelector[],
): RetrievalHit | undefined {
  return hits.find((hit) =>
    selectors.some((selector) => hitMatchesSelector(hit, selector)),
  );
}

function answerPointCoverage(hits: RetrievalHit[], points: string[]): number {
  if (points.length === 0) return 1;
  const corpus = hits.map((hit) => hit.content).join('\n');
  const matched = points.filter((point) => corpus.includes(point)).length;
  return matched / points.length;
}

async function resolvePersonaId(
  app: INestApplicationContext,
  personaKey: string,
): Promise<string> {
  const seed = readJson<{
    personas: Array<{ key: string; name: string }>;
  }>(resolve(process.cwd(), 'eval/rag/rag-eval.seed.json'));
  const seedPersona = seed.personas.find((item) => item.key === personaKey);
  if (!seedPersona) throw new Error(`评估 personaKey 不存在：${personaKey}`);

  const personaService = app.get(PersonaService);
  const persona = (await personaService.findAll()).find(
    (item) => item.name === seedPersona.name,
  );
  if (!persona) {
    throw new Error(`未找到评估 persona：${seedPersona.name}，请先运行 rag:seed-eval`);
  }
  return persona.id;
}

async function resolveKnowledgeBaseIds(
  app: INestApplicationContext,
  keys: string[],
): Promise<string[]> {
  const seed = readJson<{
    knowledgeBases: Array<{ key: string; name: string }>;
  }>(resolve(process.cwd(), 'eval/rag/rag-eval.seed.json'));
  const kbService = app.get(KnowledgeBaseService);
  const allKbs = await kbService.listAll();

  return keys.map((key) => {
    const seedKb = seed.knowledgeBases.find((item) => item.key === key);
    if (!seedKb) throw new Error(`评估 knowledgeBaseKey 不存在：${key}`);
    const kb = allKbs.find((item) => item.name === seedKb.name);
    if (!kb) {
      throw new Error(`未找到评估知识库：${seedKb.name}，请先运行 rag:seed-eval`);
    }
    return kb.id;
  });
}

function summarize(results: CaseResult[]) {
  const count = Math.max(results.length, 1);
  return {
    cases: results.length,
    hitAt1: results.filter((item) => item.hitAt1).length / count,
    hitAt3: results.filter((item) => item.hitAt3).length / count,
    hitAt5: results.filter((item) => item.hitAt5).length / count,
    mrr:
      results.reduce((sum, item) => sum + item.reciprocalRank, 0) / count,
    answerPointCoverage:
      results.reduce((sum, item) => sum + item.answerPointCoverage, 0) / count,
    lowConfidenceAccuracy:
      results.filter((item) => item.lowConfidenceMatched).length / count,
    fallbackAccuracy:
      results.filter((item) => item.fallbackMatched).length / count,
  };
}

async function evaluateCase(
  app: INestApplicationContext,
  item: EvalCase,
  options: {
    rewrite: boolean;
    retrievalMode?: 'vector' | 'keyword' | 'hybrid';
  },
): Promise<CaseResult> {
  const knowledgeService = app.get(KnowledgeService);
  let trace: RagDebugTrace;
  if (item.personaKey) {
    const personaId = await resolvePersonaId(app, item.personaKey);
    trace = (
      await knowledgeService.retrieveForPersonaWithTrace(personaId, item.query, {
        rewrite: options.rewrite,
        retrievalMode: options.retrievalMode,
        history: item.history,
      })
    ).debugTrace;
  } else {
    const [kbId] = await resolveKnowledgeBaseIds(
      app,
      item.knowledgeBaseKeys ?? [],
    );
    if (!kbId) throw new Error(`case ${item.id} 缺少 knowledgeBaseKeys`);
    trace = (
      await knowledgeService.retrieveWithStages(kbId, item.query, {
        rewrite: options.rewrite,
        retrievalMode: options.retrievalMode,
        history: item.history,
      })
    ).debugTrace;
  }

  const match = firstMatchingHit(trace.hits, item.expectedHitSelectors);
  const firstMatchRank = match?.rank ?? null;
  const reciprocalRank = firstMatchRank ? 1 / firstMatchRank : 0;
  const beforeRank = trace.rerank?.before.find(
    (row) => row.id === match?.id,
  )?.rank;
  const afterRank = trace.rerank?.after.find(
    (row) => row.id === match?.id,
  )?.rank;

  return {
    id: item.id,
    category: item.category,
    hitAt1: firstMatchRank !== null && firstMatchRank <= 1,
    hitAt3: firstMatchRank !== null && firstMatchRank <= 3,
    hitAt5: firstMatchRank !== null && firstMatchRank <= 5,
    reciprocalRank,
    answerPointCoverage: answerPointCoverage(
      trace.hits,
      item.expectedAnswerPoints,
    ),
    lowConfidenceMatched:
      item.expectedLowConfidence === undefined ||
      trace.lowConfidence === item.expectedLowConfidence,
    fallbackMatched:
      item.shouldTriggerFallback === undefined ||
      trace.fallback?.used === item.shouldTriggerFallback,
    firstMatchRank,
    rerankDelta:
      beforeRank !== undefined && afterRank !== undefined
        ? beforeRank - afterRank
        : null,
    traceId: trace.traceId,
    langsmithRunId: trace.langsmithRunId,
  };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    if (hasArg('--seed')) {
      await seedEvalDataset(app);
    }
    const rewrite = boolArg('--rewrite', false);
    const rawMode = argValue('--mode');
    const retrievalMode =
      rawMode === 'vector' || rawMode === 'keyword' || rawMode === 'hybrid'
        ? rawMode
        : undefined;

    const cases = readJson<EvalCase[]>(
      resolve(process.cwd(), 'eval/rag/rag-eval.cases.json'),
    );
    const caseFilter = argValue('--case');
    const selectedCases = caseFilter
      ? cases.filter((item) => item.id === caseFilter)
      : cases;
    if (selectedCases.length === 0) {
      throw new Error(`没有匹配的评估 case：${caseFilter}`);
    }

    const results: CaseResult[] = [];
    for (const item of selectedCases) {
      results.push(
        await evaluateCase(app, item, {
          rewrite,
          retrievalMode,
        }),
      );
    }

    console.log(
      JSON.stringify(
        {
          mode: retrievalMode ?? 'configured',
          rewrite,
          summary: summarize(results),
          cases: results,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
