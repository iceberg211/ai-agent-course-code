import type { RetryPolicy } from '@langchain/langgraph';
import { isAbortError } from '@/common/utils';
import {
  DEFAULT_RAG_RETRY_INITIAL_INTERVAL_MS,
  DEFAULT_RAG_RETRY_BACKOFF_FACTOR,
  DEFAULT_RAG_RETRY_MAX_INTERVAL_MS,
} from '@/agent/agent.constants';

export const RAG_DEPENDENCY_RETRY_MAX_ATTEMPTS = 3;

export function isTransientRagDependencyError(error: unknown): boolean {
  if (isAbortError(error)) {
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
  initialInterval: DEFAULT_RAG_RETRY_INITIAL_INTERVAL_MS,
  backoffFactor: DEFAULT_RAG_RETRY_BACKOFF_FACTOR,
  maxInterval: DEFAULT_RAG_RETRY_MAX_INTERVAL_MS,
  jitter: false,
  retryOn: isTransientRagDependencyError,
};
