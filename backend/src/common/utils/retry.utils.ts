export interface RetryLogger {
  warn(message: string): void;
}

export interface WithRetryOptions {
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  logger?: RetryLogger;
  shouldRetry?: (error: unknown) => boolean;
  formatRetryMessage?: (params: {
    operation: string;
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => string;
}

const DEFAULT_TRANSIENT_DB_ERROR_PATTERN =
  /Connection terminated unexpectedly|ECONNRESET|ETIMEDOUT|too many clients|terminating connection/i;
const DEFAULT_TRANSIENT_INFRASTRUCTURE_ERROR_PATTERN =
  /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|Connection terminated unexpectedly|socket hang up|ECONNREFUSED|too many clients|502|503|504|429/i;

export function isTransientDbError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return DEFAULT_TRANSIENT_DB_ERROR_PATTERN.test(message);
}

export function isTransientInfrastructureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return DEFAULT_TRANSIENT_INFRASTRUCTURE_ERROR_PATTERN.test(message);
}

export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function withRetry<T>(
  operation: string,
  fn: () => Promise<T>,
  options: WithRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(options.attempts ?? 2, 1);
  const shouldRetry = options.shouldRetry ?? (() => true);
  let delayMs = Math.max(options.initialDelayMs ?? 200, 0);
  const maxDelayMs = Math.max(options.maxDelayMs ?? delayMs, delayMs);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt >= attempts) {
        throw error;
      }

      options.logger?.warn(
        options.formatRetryMessage?.({
          operation,
          attempt,
          delayMs,
          error,
        }) ??
          `${operation} 第 ${attempt} 次失败，${delayMs}ms 后重试：${formatErrorMessage(
            error,
          )}`,
      );
      if (delayMs > 0) {
        await sleep(delayMs);
        delayMs = Math.min(delayMs * 2, maxDelayMs);
      }
    }
  }

  throw lastError ?? new Error(`${operation} 重试流程异常结束`);
}
