export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
}

export async function consumeSseEvents(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      buffer += decoder.decode(value, { stream: true });
      buffer = flushSseBuffer(buffer, onEvent);
    }

    buffer += decoder.decode();
    flushSseBuffer(buffer, onEvent, true);
  } finally {
    reader.releaseLock();
  }
}

function flushSseBuffer(
  buffer: string,
  onEvent: (event: SseEvent) => void,
  isEnd = false,
): string {
  let current = buffer;

  while (true) {
    const boundaryIndex = current.search(/\r?\n\r?\n/);
    if (boundaryIndex === -1) break;

    const eventBlock = current.slice(0, boundaryIndex);
    const separatorLength = current.startsWith('\r\n\r\n', boundaryIndex)
      ? 4
      : 2;
    current = current.slice(boundaryIndex + separatorLength);
    emitSseEvent(eventBlock, onEvent);
  }

  if (isEnd && current.trim()) {
    emitSseEvent(current, onEvent);
    return '';
  }

  return current;
}

function emitSseEvent(
  eventBlock: string,
  onEvent: (event: SseEvent) => void,
): void {
  let id = '';
  let event = '';
  const dataLines: string[] = [];

  for (const line of eventBlock.split(/\r?\n/)) {
    if (line.startsWith('id:')) {
      id = line.slice(3).trim();
      continue;
    }
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return;

  const data = dataLines.join('\n').trim();
  if (!data || data === '[DONE]') return;

  onEvent({
    id: id || undefined,
    event: event || undefined,
    data,
  });
}
