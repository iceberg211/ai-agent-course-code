import type { RunnableConfig } from '@langchain/core/runnables';
import { traceable } from 'langsmith/traceable';

type LangSmithValue =
  | string
  | number
  | boolean
  | null
  | LangSmithValue[]
  | { [key: string]: LangSmithValue };

type LangSmithMetadata = Record<string, LangSmithValue | undefined>;

interface LangSmithRunnableConfigInput {
  runName: string;
  tags?: string[];
  metadata?: LangSmithMetadata;
}

interface LangSmithTraceScopeOptions<TOutput> {
  name: string;
  runType?: string;
  tags?: string[];
  metadata?: LangSmithMetadata;
  input?: LangSmithMetadata;
  outputProcessor?: (output: TOutput) => LangSmithMetadata;
}

function normalizeTags(tags?: string[]): string[] | undefined {
  if (!tags?.length) return undefined;
  const normalized = Array.from(
    new Set(
      tags
        .map((tag) => String(tag ?? '').trim())
        .filter((tag) => tag.length > 0),
    ),
  );
  return normalized.length > 0 ? normalized : undefined;
}

export function compactLangSmithMetadata(
  metadata?: LangSmithMetadata,
): Record<string, LangSmithValue> | undefined {
  if (!metadata) return undefined;
  const normalizedEntries = Object.entries(metadata).filter(
    ([, value]) => value !== undefined,
  ) as Array<[string, LangSmithValue]>;

  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
}

export function buildLangSmithRunnableConfig(
  input: LangSmithRunnableConfigInput,
): RunnableConfig {
  return {
    runName: input.runName,
    tags: normalizeTags(input.tags),
    metadata: compactLangSmithMetadata(input.metadata),
  };
}

export async function runInTracedScope<TOutput>(
  options: LangSmithTraceScopeOptions<TOutput>,
  fn: () => Promise<TOutput> | TOutput,
): Promise<TOutput> {
  const processOutputs = options.outputProcessor
    ? async (output: unknown) =>
        compactLangSmithMetadata(
          options.outputProcessor?.(output as TOutput),
        ) ?? {}
    : undefined;

  const traced = traceable(
    async (input: Record<string, LangSmithValue>) => {
      void input;
      return fn();
    },
    {
      name: options.name,
      run_type: options.runType ?? 'chain',
      tags: normalizeTags(options.tags),
      metadata: compactLangSmithMetadata(options.metadata),
      processInputs: async (input) =>
        compactLangSmithMetadata(input as LangSmithMetadata) ?? {},
      processOutputs,
    },
  );

  return traced(compactLangSmithMetadata(options.input) ?? {});
}
