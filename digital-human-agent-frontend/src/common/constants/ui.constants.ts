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

export type KnowledgeTabKey = 'documents' | 'health' | 'hit-test' | 'settings';
export type KnowledgeTabKeyWithGraph = KnowledgeTabKey | 'graph';

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
  idle: '点击“连线”开启音视频数字人对话，或点击话筒图标说话。',
  recording: '正在聆听，请说话。说话完毕后松开或点击停止。',
  thinking: '正在生成回答…',
  speaking: '数字人正在播报中，随时可以插话打断。',
};

export const CHAT_CONTROL_ARIA_LABELS: Partial<
  Record<ConversationState, string>
> = {
  idle: '点击开始录音',
  recording: '点击结束录音并发送',
  thinking: '点击打断当前回答并开始录音',
  speaking: '点击打断当前播报并开始录音',
};

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  completed: '成功',
  failed: '失败',
  interrupted: '已打断',
};

export const VOICE_CLONE_STATUS_LABELS: Record<VoiceCloneStatus, string> = {
  not_started: '未开始',
  pending: '排队中',
  training: '训练中',
  ready: '可使用',
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

export const DOCUMENT_TASK_STATUS_LABELS: Record<string, string> = {
  pending: '等待排队',
  running: '解析中',
  completed: '已完成',
  failed: '失败',
};

export const KNOWLEDGE_DOCUMENT_STATUS_LABELS = DOCUMENT_TASK_STATUS_LABELS;

export const KNOWLEDGE_BASE_DETAIL_TABS: Array<{
  key: KnowledgeTabKeyWithGraph;
  label: string;
}> = [
  { key: 'documents', label: '文档' },
  { key: 'health', label: '健康' },
  { key: 'graph', label: '知识图谱' },
  { key: 'settings', label: '配置' },
  { key: 'hit-test', label: '问答验证' },
];

export const APP_NAV_ITEMS = [
  { to: '/dashboard', label: '首页大盘', icon: 'dashboard' },
  { to: '/documents', label: '文档管理', icon: 'documents' },
  { to: '/search', label: '智能搜索', icon: 'search' },
  { to: '/chat', label: 'AI 问答', icon: 'chat' },
  { to: '/kb', label: '知识库', icon: 'knowledge' },
  { to: '/evaluation', label: '评估验证', icon: 'evaluation' },
  { to: '/rbac', label: '系统管理', icon: 'rbac' },
  { to: '/profile', label: '个人中心', icon: 'profile' },
] as const;
