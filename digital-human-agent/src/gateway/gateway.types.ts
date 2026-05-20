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

// ── WebSocket 出站消息结构（强类型） ───────────────────────────────────────────────

export interface WsPongMessage extends WsBaseMessage {
  type: 'pong';
  sessionId: '';
  payload: {
    ts: number;
  };
}

export interface WsErrorMessage extends WsBaseMessage {
  type: 'error';
  sessionId: string;
  payload: {
    message: string;
  };
}

export interface WsSessionReadyMessage extends WsBaseMessage {
  type: 'session:ready';
  sessionId: string;
  payload: {
    conversationId: string;
    mode: string;
    history: SessionHistoryMessage[];
    historyLimit: number;
  };
}

export interface WsDigitalHumanReadyMessage extends WsBaseMessage {
  type: 'digital-human:ready';
  sessionId: string;
  payload: {
    provider: string;
    digitalSessionId: string;
    speakMode: string;
    credentials?: unknown;
  };
}

export interface WsConversationStartMessage extends WsBaseMessage {
  type: 'conversation:start';
  sessionId: string;
  turnId: string;
}

export interface WsConversationTextChunkMessage extends WsBaseMessage {
  type: 'conversation:text_chunk';
  sessionId: string;
  turnId: string;
  payload: {
    token: string;
  };
}

export interface WsConversationCitationsMessage extends WsBaseMessage {
  type: 'conversation:citations';
  sessionId: string;
  turnId: string;
  payload: {
    citations: unknown;
  };
}

export interface WsConversationDoneMessage extends WsBaseMessage {
  type: 'conversation:done';
  sessionId: string;
  turnId: string;
  payload: {
    status: 'completed' | 'interrupted' | 'failed';
  };
}

export interface WsTtsStartMessage extends WsBaseMessage {
  type: 'tts:start';
  sessionId: string;
  turnId: string;
  payload: {
    encoding: 'mp3' | 'pcm';
  };
}

export interface WsTtsEndMessage extends WsBaseMessage {
  type: 'tts:end';
  sessionId: string;
  turnId: string;
}

export interface WsDigitalHumanStartMessage extends WsBaseMessage {
  type: 'digital-human:start';
  sessionId: string;
  turnId: string;
}

export interface WsDigitalHumanSubtitleMessage extends WsBaseMessage {
  type: 'digital-human:subtitle';
  sessionId: string;
  turnId: string;
  payload: {
    text: string;
  };
}

export interface WsDigitalHumanEndMessage extends WsBaseMessage {
  type: 'digital-human:end';
  sessionId: string;
  turnId: string;
}

export interface WsAsrFinalMessage extends WsBaseMessage {
  type: 'asr:final';
  sessionId: string;
  payload: {
    text: string;
  };
}

export interface WsConversationInterruptedMessage extends WsBaseMessage {
  type: 'conversation:interrupted';
  sessionId: string;
  payload: {
    status: 'interrupted';
  };
}

export type WsOutboundMessage =
  | WsPongMessage
  | WsErrorMessage
  | WsSessionReadyMessage
  | WsDigitalHumanReadyMessage
  | WsConversationStartMessage
  | WsConversationTextChunkMessage
  | WsConversationCitationsMessage
  | WsConversationDoneMessage
  | WsTtsStartMessage
  | WsTtsEndMessage
  | WsDigitalHumanStartMessage
  | WsDigitalHumanSubtitleMessage
  | WsDigitalHumanEndMessage
  | WsAsrFinalMessage
  | WsConversationInterruptedMessage;

