import type {
  ConversationState,
  MessageStatus,
  VoiceCloneStatus,
} from '@/types';

export type DigitalHumanUiStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'mock'
  | 'error';

export type KnowledgeTabKey = 'documents' | 'hit-test' | 'settings';

export const CHAT_CONTROL_STATE_LABELS: Record<ConversationState, string> = {
  idle: '待命',
  recording: '录音中',
  thinking: '思考中',
  speaking: '播报中',
  closed: '已结束',
};

export const CHAT_CONTROL_HINT_LABELS: Partial<
  Record<ConversationState, string>
> = {
  idle: '按住说话',
  recording: '松开 · 1 秒后发送',
  thinking: '点击打断',
  speaking: '点击打断',
};

export const CHAT_CONTROL_ARIA_LABELS: Partial<
  Record<ConversationState, string>
> = {
  idle: '按住开始录音',
  recording: '松开发送语音',
  thinking: '点击打断 AI',
  speaking: '点击打断 AI',
};

export const MESSAGE_STATUS_LABELS: Partial<Record<MessageStatus, string>> = {
  interrupted: '回复已中断',
  failed: '回复失败',
};

export const VOICE_CLONE_STATUS_LABELS: Record<VoiceCloneStatus, string> = {
  not_started: '未开始',
  pending: '排队中',
  training: '训练中',
  ready: '已就绪',
  failed: '失败',
};

export const DIGITAL_HUMAN_STATUS_LABELS: Record<
  DigitalHumanUiStatus,
  string
> = {
  idle: '待命',
  connecting: '连接中',
  connected: '已连接',
  mock: 'Mock',
  error: '异常',
};

export const KNOWLEDGE_DOCUMENT_STATUS_LABELS: Record<string, string> = {
  pending: '排队中',
  processing: '处理中',
  completed: '就绪',
  failed: '失败',
};

export const KNOWLEDGE_BASE_DETAIL_TABS: Array<{
  key: KnowledgeTabKey;
  label: string;
}> = [
  { key: 'documents', label: '文档' },
  { key: 'settings', label: '配置' },
  { key: 'hit-test', label: '命中测试' },
];

export const APP_NAV_ITEMS = [
  { to: '/chat', label: '知识问答', icon: 'chat' },
  { to: '/kb', label: '知识库', icon: 'knowledge' },
] as const;
