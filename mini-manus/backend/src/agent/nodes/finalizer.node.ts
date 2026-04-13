import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { AgentState } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { ArtifactType } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { EventPublisher } from '@/event/event.publisher';
import { createPdfBufferFromText } from '@/tool/utils/pdf-export';
import { finalizerJsonPrompt, finalizerPrompt } from '@/prompts';
import { TokenBudgetGuard } from '@/agent/token-budget.guard';

/** 从 LLM 输出中解析 "TYPE: xxx" 标记行，返回 [artifactType, 内容主体] */
function parseArtifactType(raw: string): [ArtifactType, string] {
  const match = raw.match(/^TYPE:\s*(markdown|code|diagram)\s*\n/i);
  if (!match) return [ArtifactType.MARKDOWN, raw];

  const typeStr = match[1].toLowerCase();
  const typeMap: Record<string, ArtifactType> = {
    code: ArtifactType.CODE,
    diagram: ArtifactType.DIAGRAM,
    markdown: ArtifactType.MARKDOWN,
  };
  const artifactType = typeMap[typeStr] ?? ArtifactType.MARKDOWN;
  const content = raw.slice(match[0].length).trimStart();
  return [artifactType, content];
}

const FinalizerJsonSchema = z.object({
  summary: z.string(),
  sources: z.array(z.string()).default([]),
  key_points: z.array(z.string()).default([]),
  artifact_type: z.enum(['markdown', 'code', 'diagram']),
});

function normalizeArtifact(
  artifactType: ArtifactType,
  content: string,
): { content: string; metadata: Record<string, unknown> | null } {
  if (artifactType === ArtifactType.CODE) {
    const fencedMatch = content.match(/```([\w-]+)?\n([\s\S]*?)```/);
    if (fencedMatch) {
      return {
        content: fencedMatch[2].trim(),
        metadata: {
          language: fencedMatch[1]?.trim() || 'text',
        },
      };
    }
    return { content: content.trim(), metadata: { language: 'text' } };
  }

  if (artifactType === ArtifactType.DIAGRAM) {
    const mermaidMatch = content.match(/```mermaid\s*([\s\S]*?)```/i);
    return {
      content: (mermaidMatch?.[1] ?? content).trim(),
      metadata: { renderer: 'mermaid' },
    };
  }

  return { content: content.trim(), metadata: null };
}

function emitArtifactCreated(
  eventPublisher: EventPublisher,
  state: AgentState,
  artifact: { id: string; title: string },
  type: ArtifactType,
) {
  eventPublisher.emit(TASK_EVENTS.ARTIFACT_CREATED, {
    taskId: state.taskId,
    runId: state.runId,
    artifactId: artifact.id,
    type,
    title: artifact.title,
  });
}

export async function finalizerNode(
  state: AgentState,
  llm: ChatOpenAI,
  callbacks: AgentCallbacks,
  eventPublisher: EventPublisher,
  exportPdfEnabled: boolean,
  soMethod: 'functionCalling' | 'json_schema' | 'jsonMode' = 'functionCalling',
  tokenBudgetGuard?: TokenBudgetGuard,
): Promise<Partial<AgentState>> {
  const initialBudgetFailure = tokenBudgetGuard?.check();
  if (initialBudgetFailure) {
    return {
      evaluation: initialBudgetFailure,
      errorMessage: initialBudgetFailure.reason,
    };
  }

  const executionContext = state.stepResults
    .map(
      (s) =>
        `步骤 ${s.executionOrder + 1}: ${s.description}\n结果: ${s.resultSummary}`,
    )
    .join('\n\n');

  const chain = finalizerPrompt.pipe(llm);
  const response = await chain.invoke({
    revisionInput: state.revisionInput,
    executionContext,
  });

  const rawContent =
    typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

  const artifactBudgetFailure = tokenBudgetGuard?.check();
  if (artifactBudgetFailure) {
    return {
      evaluation: artifactBudgetFailure,
      errorMessage: artifactBudgetFailure.reason,
    };
  }

  // 解析 LLM 输出中的 TYPE 标记，决定产物类型
  const [artifactType, content] = parseArtifactType(rawContent);
  const normalized = normalizeArtifact(artifactType, content);
  const generatedAt = new Date().toISOString();
  const artifactTitle = `任务产物: ${state.revisionInput.slice(0, 50)}`;

  const artifact = await callbacks.saveArtifact(
    state.runId,
    artifactTitle,
    normalized.content,
    artifactType,
    {
      ...(normalized.metadata ?? {}),
      generatedAt,
    },
  );
  emitArtifactCreated(eventPublisher, state, artifact, artifactType);

  const jsonBudgetFailure = tokenBudgetGuard?.check();
  if (jsonBudgetFailure) {
    return {
      evaluation: jsonBudgetFailure,
      errorMessage: jsonBudgetFailure.reason,
    };
  }

  const jsonChain = finalizerJsonPrompt.pipe(
    llm.withStructuredOutput(FinalizerJsonSchema, { method: soMethod }),
  );
  const jsonSummary = await jsonChain.invoke({
    revisionInput: state.revisionInput,
    artifactType,
    executionContext,
  });

  const summaryArtifact = await callbacks.saveArtifact(
    state.runId,
    `结构化摘要: ${state.revisionInput.slice(0, 40)}`,
    JSON.stringify(
      {
        summary: jsonSummary.summary,
        sources: jsonSummary.sources,
        key_points: jsonSummary.key_points,
        artifact_type: artifactType,
        generated_at: generatedAt,
      },
      null,
      2,
    ),
    ArtifactType.JSON,
    {
      sourceArtifactId: artifact.id,
      generatedAt,
    },
  );
  emitArtifactCreated(eventPublisher, state, summaryArtifact, ArtifactType.JSON);

  if (exportPdfEnabled) {
    const pdfBytes = await createPdfBufferFromText(
      artifactTitle,
      normalized.content,
    );
    const fileArtifact = await callbacks.saveArtifact(
      state.runId,
      `PDF 导出: ${state.revisionInput.slice(0, 40)}`,
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
    emitArtifactCreated(eventPublisher, state, fileArtifact, ArtifactType.FILE);
  }

  return {};
}
