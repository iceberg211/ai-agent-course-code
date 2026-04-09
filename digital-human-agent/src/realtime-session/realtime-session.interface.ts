export interface RealtimeSession {
  sessionId: string;
  conversationId: string;
  personaId: string;
  activeTurnId: string | null;
  abortController: AbortController | null;
  sentenceBuffer: string; // 按句缓冲区
  wsClientId: string; // 对应的 WebSocket 连接标识
}
