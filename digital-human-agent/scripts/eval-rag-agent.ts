import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { LangGraphRagOrchestratorService } from '@/agent/orchestrators/langgraph-rag-orchestrator.service';
import {
  evaluateRagAgentGoldenCase,
  parseRagAgentGoldenCases,
  type RagAgentGoldenEvaluation,
} from '@/agent/evaluation/rag-agent-golden-eval';
import { getRagProfile } from '@/common/rag/rag-profile';

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  return (
    process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ??
    null
  );
}

function loadDotEnv(): void {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    if (process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const goldenPath = resolve(readArg('file') ?? 'eval/rag-golden-set.json');
  const cases = parseRagAgentGoldenCases(
    JSON.parse(readFileSync(goldenPath, 'utf8')) as unknown,
  );
  const requestedProfile = readArg('profileId');
  const requestedPersonaId = readArg('personaId');
  const allowFailures = process.argv.includes('--allow-failures');
  const { AppModule } =
    require('@/app.module') as typeof import('@/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const orchestrator = app.get(LangGraphRagOrchestratorService);
    const results: Array<
      RagAgentGoldenEvaluation & {
        profileId: string;
        latencyMs: number;
        firstTokenLatencyMs: number | null;
        llmCalls: number | null;
        embedCalls: number | null;
      }
    > = [];
    for (const goldenCase of cases) {
      const profile = getRagProfile(
        requestedProfile ?? goldenCase.profileId ?? 'balanced_chat',
      );
      const startedAt = Date.now();
      const workflowResult = await orchestrator.run({
        conversationId: `eval-${randomUUID()}`,
        personaId: requestedPersonaId ?? goldenCase.personaId,
        question: goldenCase.query,
        turnId: randomUUID(),
        signal: new AbortController().signal,
        onToken: () => undefined,
        onCitations: () => undefined,
        profileId: profile.id,
        startedAt,
      });
      results.push({
        ...evaluateRagAgentGoldenCase(goldenCase, workflowResult),
        profileId: profile.id,
        latencyMs: Date.now() - startedAt,
        firstTokenLatencyMs:
          workflowResult.budgetSnapshot?.firstTokenLatencyMs ?? null,
        llmCalls: workflowResult.budgetSnapshot?.llmCalls ?? null,
        embedCalls: workflowResult.budgetSnapshot?.embedCalls ?? null,
      });
    }

    const passedCount = results.filter((item) => item.passed).length;
    const output = {
      goldenPath,
      total: results.length,
      passed: passedCount,
      failed: results.length - passedCount,
      passRate: results.length === 0 ? 1 : passedCount / results.length,
      results,
    };
    console.log(JSON.stringify(output, null, 2));
    if (!allowFailures && passedCount !== results.length) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main().catch((error) => {
  console.error(
    `Agent golden set 评测失败：${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
