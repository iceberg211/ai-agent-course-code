import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { getStore } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { AgentState } from '@/agent/agent.state';
import { getCtx } from '@/agent/agent.context';
import { getIntentConfig } from '@/agent/intent.config';
import { ArtifactType } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { createPdfBufferFromText } from '@/tool/utils/pdf-export';
import { finalizerJsonPrompt, finalizerPrompt } from '@/prompts';

const logger = new Logger('FinalizerNode');

function parseArtifactType(raw: string): [ArtifactType, string] {
  const match = raw.match(/^TYPE:\s*(markdown|code|diagram)\s*\n/i);
  if (!match) return [ArtifactType.MARKDOWN, raw];
  const typeMap: Record<string, ArtifactType> = {
    code: ArtifactType.CODE,
    diagram: ArtifactType.DIAGRAM,
    markdown: ArtifactType.MARKDOWN,
  };
  return [typeMap[match[1].toLowerCase()] ?? ArtifactType.MARKDOWN, raw.slice(match[0].length).trimStart()];
}

function normalizeArtifact(
  type: ArtifactType,
  content: string,
): { content: string; metadata: Record<string, unknown> | null } {
  if (type === ArtifactType.CODE) {
    const m = content.match(/```([\w-]+)?\n([\s\S]*?)```/);
    return m
      ? { content: m[2].trim(), metadata: { language: m[1]?.trim() || 'text' } }
      : { content: content.trim(), metadata: { language: 'text' } };
  }
  if (type === ArtifactType.DIAGRAM) {
    const m = content.match(/```mermaid\s*([\s\S]*?)```/i);
    return { content: (m?.[1] ?? content).trim(), metadata: { renderer: 'mermaid' } };
  }
  return { content: content.trim(), metadata: null };
}

const FinalizerJsonSchema = z.object({
  summary: z.string(),
  sources: z.array(z.string()).default([]),
  key_points: z.array(z.string()).default([]),
  artifact_type: z.enum(['markdown', 'code', 'diagram']),
});

export async function finalizerNode(
  state: AgentState,
  config: RunnableConfig,
): Promise<Partial<AgentState>> {
  const ctx = getCtx(config);

  // 1. Token budget check
  const budgetFailure = ctx.tokenBudgetGuard.check();
  if (budgetFailure) return { error: budgetFailure.reason };

  const executionContext = state.stepResults
    .map(s => `步骤 ${s.executionOrder + 1}: ${s.description}\n结果: ${s.toolOutput ?? s.resultSummary}`)
    .join('\n\n');

  // 2. Determine artifact source — intent config drives whether to skip LLM generation
  const intentConfig = getIntentConfig(state.intent);
  const lastStepResult = state.stepResults[state.stepResults.length - 1];
  const writerOutput =
    intentConfig.useLastStepAsArtifact && lastStepResult
      ? (lastStepResult.toolOutput ?? lastStepResult.resultSummary ?? '')
      : '';
  const useWriterOutput = writerOutput.length > 200;

  let rawContent: string;
  if (useWriterOutput) {
    logger.log(`使用 writer 输出作为 artifact 主体（${writerOutput.length} chars）`);
    rawContent = writerOutput;
  } else {
    const chain = finalizerPrompt.pipe(ctx.llm);
    const response = await chain.invoke({ revisionInput: state.userInput, executionContext });
    rawContent = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  }

  // 3. Budget re-check after LLM call
  const budgetFailure2 = ctx.tokenBudgetGuard.check();
  if (budgetFailure2) return { error: budgetFailure2.reason };

  // 4. Parse TYPE marker and normalize content
  const [artifactType, content] = parseArtifactType(rawContent);
  const normalized = normalizeArtifact(artifactType, content);
  logger.log(`产物类型: ${artifactType} | 内容长度: ${normalized.content.length} chars`);
  const generatedAt = new Date().toISOString();
  const artifactTitle = `任务产物: ${state.userInput.slice(0, 50)}`;

  // 5. Save main artifact and emit event
  const artifact = await ctx.callbacks.saveArtifact(
    state.runId, artifactTitle, normalized.content, artifactType,
    { ...(normalized.metadata ?? {}), generatedAt },
  );
  ctx.eventPublisher.emit(TASK_EVENTS.ARTIFACT_CREATED, {
    taskId: state.taskId, runId: state.runId, artifactId: artifact.id,
    type: artifactType, title: artifact.title,
  });

  // 6. LLM-generated JSON summary (skip if budget exceeded)
  const budgetFailure3 = ctx.tokenBudgetGuard.check();
  if (!budgetFailure3) {
    try {
      const jsonChain = finalizerJsonPrompt.pipe(
        ctx.llm.withStructuredOutput(FinalizerJsonSchema, { method: ctx.soMethod }),
      );
      const jsonSummary = await jsonChain.invoke({
        revisionInput: state.userInput, artifactType, executionContext,
      });
      const summaryArtifact = await ctx.callbacks.saveArtifact(
        state.runId,
        `结构化摘要: ${state.userInput.slice(0, 40)}`,
        JSON.stringify({
          summary: jsonSummary.summary,
          sources: jsonSummary.sources,
          key_points: jsonSummary.key_points,
          artifact_type: artifactType,
          generated_at: generatedAt,
        }, null, 2),
        ArtifactType.JSON,
        { sourceArtifactId: artifact.id, generatedAt },
      );
      ctx.eventPublisher.emit(TASK_EVENTS.ARTIFACT_CREATED, {
        taskId: state.taskId, runId: state.runId, artifactId: summaryArtifact.id,
        type: ArtifactType.JSON, title: summaryArtifact.title,
      });
    } catch (err) {
      logger.warn(`JSON 摘要生成失败: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 7. Optional PDF export
  if (ctx.exportPdfEnabled) {
    try {
      const pdfBytes = await createPdfBufferFromText(artifactTitle, normalized.content);
      const fileArtifact = await ctx.callbacks.saveArtifact(
        state.runId,
        `PDF 导出: ${state.userInput.slice(0, 40)}`,
        Buffer.from(pdfBytes).toString('base64'),
        ArtifactType.FILE,
        {
          fileName: `${artifactTitle.replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}.pdf`,
          mimeType: 'application/pdf',
          encoding: 'base64',
          sizeBytes: pdfBytes.byteLength,
          sourceArtifactId: artifact.id,
          generatedAt,
        },
      );
      ctx.eventPublisher.emit(TASK_EVENTS.ARTIFACT_CREATED, {
        taskId: state.taskId, runId: state.runId, artifactId: fileArtifact.id,
        type: ArtifactType.FILE, title: fileArtifact.title,
      });
      logger.log(`PDF 导出成功 (${pdfBytes.byteLength} bytes)`);
    } catch (err) {
      logger.warn(`PDF 导出失败（不影响主产物）: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 8. Write cross-run memory to LangGraph Store
  const store = getStore(config);
  if (store) {
    try {
      await store.put(['task_memory', state.taskId], state.runId, {
        summary: `${state.userInput.slice(0, 100)} → ${state.stepResults.length} 步完成`,
        completedAt: new Date().toISOString(),
        stepCount: state.stepResults.length,
        retryCount: state.retryCount,
        replanCount: state.replanCount,
      });
    } catch { /* ignore — store write must not block finalizer */ }
  }

  return {};
}
