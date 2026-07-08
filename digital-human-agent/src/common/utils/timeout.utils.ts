import { createAbortError } from '@/common/utils/error.utils';

export interface WithTimeoutOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  timeoutMessage?: string;
}

export async function withTimeout<T>(
  operation: string,
  fn: (signal?: AbortSignal) => Promise<T>,
  options: WithTimeoutOptions = {},
): Promise<T> {
  const timeoutMs = Math.max(Number(options.timeoutMs ?? 0), 0);
  if (!timeoutMs) {
    return fn(options.signal);
  }

  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const controller = new AbortController();
  let timeout: NodeJS.Timeout | null = null;
  let onAbort: (() => void) | null = null;

  const abortWith = (message?: string): Error => {
    const error = createAbortError();
    error.message = message || `${operation} was aborted`;
    controller.abort(error);
    return error;
  };

  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortWith());
    options.signal?.addEventListener('abort', onAbort, { once: true });
    timeout = setTimeout(() => {
      reject(abortWith(options.timeoutMessage || `${operation} timeout`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(controller.signal), abortPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
  }
}
