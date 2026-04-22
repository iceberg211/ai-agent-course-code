import type { RetryPolicy } from '@langchain/langgraph';

export const RAG_DEPENDENCY_RETRY_MAX_ATTEMPTS = 3;

export function isTransientRagDependencyError(error: unknown): boolean {
  if ((error as { name?: string })?.name === 'AbortError') {
    return false;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error ?? '');

  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|Connection terminated unexpectedly|socket hang up|ECONNREFUSED|too many clients|502|503|504|429|temporary .* failure/i.test(
    message,
  );
}

export function isBeforeFinalRetryAttempt(nodeAttempt?: number): boolean {
  return (nodeAttempt ?? 1) < RAG_DEPENDENCY_RETRY_MAX_ATTEMPTS;
}

export const RAG_DEPENDENCY_RETRY_POLICY: RetryPolicy = {
  maxAttempts: RAG_DEPENDENCY_RETRY_MAX_ATTEMPTS,
  initialInterval: 200,
  backoffFactor: 2,
  maxInterval: 1000,
  jitter: false,
  retryOn: isTransientRagDependencyError,
};
