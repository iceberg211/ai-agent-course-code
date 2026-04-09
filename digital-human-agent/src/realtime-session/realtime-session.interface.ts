export interface RealtimeSession {
  sessionId: string;
  conversationId: string;
  personaId: string;
  activeTurnId: string | null;
  abortController: AbortController | null;
  sentenceBuffer: string; // 按句缓冲区
  ttsTurnId: string | null; // 当前 TTS 队列所属 turn
  ttsQueue: string[]; // 待合成的句段队列
  ttsProcessing: boolean; // 是否正在处理 TTS 队列
  ttsSeq: number; // 当前 turn 的音频帧序号
  ttsStarted: boolean; // 是否已发送 tts:start
  ttsFinalizeRequested: boolean; // 文本结束后等待队列清空再发送 tts:end
  wsClientId: string; // 对应的 WebSocket 连接标识
}
