/**
 * Gateway 层共用的类型定义。
 * 将原本散落在 conversation.gateway.ts 中的 interface 集中管理。
 */

// ── TTS 音频帧元数据 ──────────────────────────────────────────────────────────

export interface TtsAudioFrameMeta {
  sessionId: string;
  turnId: string;
  seq: number;
  codec: 'audio/mpeg' | 'audio/pcm';
  isFinal?: boolean;
}

// ── 历史消息（发往前端的快照格式） ────────────────────────────────────────────

export interface SessionHistoryMessage {
  id: string;
  turnId: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'completed' | 'interrupted' | 'failed';
  createdAt: Date;
}

// ── WebSocket 消息结构（强类型） ───────────────────────────────────────────────

export interface WsBaseMessage {
  type: string;
  sessionId?: string;
  turnId?: string;
}

export interface WsSessionStartMessage extends WsBaseMessage {
  type: 'session:start';
  payload?: {
    personaId?: string;
    mode?: string;
    /** true 时强制新建对话，不复用最近一次 */
    forceNew?: boolean;
  };
}

export interface WsTextInputMessage extends WsBaseMessage {
  type: 'conversation:text';
  payload?: {
    text?: string;
  };
}

export interface WsInterruptMessage extends WsBaseMessage {
  type: 'conversation:interrupt';
}

/** 所有入站消息的联合类型 */
export type WsInboundMessage =
  | WsSessionStartMessage
  | WsTextInputMessage
  | WsInterruptMessage
  | ({ type: 'ping' } & WsBaseMessage);
