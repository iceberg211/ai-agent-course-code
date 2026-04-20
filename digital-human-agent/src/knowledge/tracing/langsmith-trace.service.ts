import { Injectable, Logger } from '@nestjs/common';
import { getCurrentRunTree, traceable } from 'langsmith/traceable';

type TraceRunType = 'chain' | 'retriever' | 'llm' | 'tool';

interface TraceExecutionOptions<T> {
  name: string;
  runType?: TraceRunType;
  tags?: string[];
  metadata?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  processOutputs?: (output: T) => Record<string, unknown>;
}

interface RunnableTraceOptions {
  runName: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

@Injectable()
export class LangSmithTraceService {
  private readonly logger = new Logger(LangSmithTraceService.name);
  private readonly tracingRequested = process.env.LANGSMITH_TRACING === 'true';
  private readonly enabled =
    this.tracingRequested && Boolean(process.env.LANGSMITH_API_KEY?.trim());
  private readonly projectName =
    process.env.LANGSMITH_PROJECT?.trim() || 'digital-human-agent-rag';

  constructor() {
    if (this.tracingRequested && !this.enabled) {
      this.logger.warn(
        'LANGSMITH_TRACING=true 但缺少 LANGSMITH_API_KEY，已跳过真实 Trace 上报',
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  currentRunId(): string | undefined {
    if (!this.enabled) return undefined;
    return getCurrentRunTree(true)?.id;
  }

  async trace<T>(
    options: TraceExecutionOptions<T>,
    work: () => Promise<T>,
  ): Promise<T> {
    if (!this.enabled) {
      return work();
    }

    const wrapped = traceable(
      async (_inputs: Record<string, unknown>) => work(),
      {
        name: options.name,
        run_type: options.runType ?? 'chain',
        project_name: this.projectName,
        tags: options.tags,
        metadata: options.metadata,
        processInputs: (inputs) => this.normalizeRecord(inputs),
        processOutputs: (output) =>
          this.buildOutputs(output as T, options.processOutputs),
      } as Parameters<typeof traceable>[1] & {
        metadata?: Record<string, unknown>;
      },
    );

    return wrapped(options.inputs ?? {});
  }

  runnableConfig(options: RunnableTraceOptions): RunnableTraceOptions {
    return options;
  }

  private buildOutputs<T>(
    output: T,
    custom?: (output: T) => Record<string, unknown>,
  ): Record<string, unknown> {
    if (custom) {
      try {
        return this.normalizeRecord(custom(output));
      } catch (error) {
        this.logger.warn(
          `LangSmith processOutputs 构造失败，回退默认输出：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return this.defaultOutputs(output);
  }

  private defaultOutputs(output: unknown): Record<string, unknown> {
    if (output === undefined) return {};
    if (output === null) return { output: null };
    if (typeof output === 'object' && !Array.isArray(output)) {
      return this.normalizeRecord(output as Record<string, unknown>);
    }
    return { output };
  }

  private normalizeRecord(
    record: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(record).filter(([, value]) => value !== undefined),
    );
  }
}
