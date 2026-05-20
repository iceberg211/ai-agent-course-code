interface ElasticsearchErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  hostname?: unknown;
  cause?: unknown;
  meta?: {
    statusCode?: unknown;
    attempts?: unknown;
    body?: unknown;
    connection?: {
      url?: unknown;
    };
    request?: {
      params?: {
        method?: unknown;
        path?: unknown;
      };
    };
  };
}

export function formatElasticsearchError(error: unknown): string {
  const errorLike = error as ElasticsearchErrorLike;
  const parts = [
    readMessage(error),
    readNamedValue('name', errorLike.name, (value) => value !== 'Error'),
    readNamedValue('code', errorLike.code),
    readNamedValue('hostname', errorLike.hostname),
    readNamedValue('statusCode', errorLike.meta?.statusCode),
    readNamedValue('attempts', errorLike.meta?.attempts),
    readRequest(errorLike.meta?.request?.params),
    readNamedValue(
      'url',
      redactUrl(readString(errorLike.meta?.connection?.url)),
    ),
    readBodyError(errorLike.meta?.body),
    readCause(errorLike.cause),
  ].filter((part): part is string => Boolean(part));

  if (parts.length > 0) {
    return Array.from(new Set(parts)).join(' ');
  }

  const fallback = String(error).trim();
  return fallback && fallback !== '[object Object]'
    ? fallback
    : 'unknown elasticsearch error';
}

function readMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  const message = readString((error as ElasticsearchErrorLike)?.message);
  return message || null;
}

function readNamedValue(
  name: string,
  value: unknown,
  predicate: (value: string) => boolean = () => true,
): string | null {
  const stringValue = readString(value);
  if (!stringValue || !predicate(stringValue)) return null;
  return `${name}=${stringValue}`;
}

function readRequest(params?: { method?: unknown; path?: unknown }): string | null {
  const method = readString(params?.method);
  const path = readString(params?.path);
  if (!method && !path) return null;
  return `request=${[method, path].filter(Boolean).join(' ')}`;
}

function readBodyError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const errorBody = (body as { error?: unknown }).error;
  if (!errorBody) return null;
  if (typeof errorBody === 'string') {
    return `bodyError=${errorBody}`;
  }

  const type = readString((errorBody as { type?: unknown }).type);
  const reason = readString((errorBody as { reason?: unknown }).reason);
  const bodyMessage = [type, reason].filter(Boolean).join(' ');
  return bodyMessage ? `bodyError=${bodyMessage}` : null;
}

function readCause(cause: unknown): string | null {
  if (!cause) return null;
  const code = readString((cause as { code?: unknown }).code);
  const message =
    cause instanceof Error
      ? cause.message.trim()
      : readString((cause as { message?: unknown }).message);
  const text = [code, message].filter(Boolean).join(' ');
  return text ? `cause=${text}` : null;
}

function readString(value: unknown): string {
  if (value instanceof URL) {
    return value.toString();
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function redactUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return rawUrl.replace(/\/\/[^/@\s]+@/, '//');
  }
}
