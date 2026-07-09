import { Annotation } from '@langchain/langgraph';
import {
  DEFAULT_RAG_MAX_HOPS,
  DEFAULT_RAG_MAX_WEB_SEARCH_ATTEMPTS,
  DEFAULT_RAG_WORKFLOW_BUDGET_MS,
} from '@/agent/agent.constants';
import { DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG } from '@/common/constants';
import { DEFAULT_RETRIEVAL_STRATEGY, getRagProfile } from '@/common/rag';
import {
  getCurrentQuery,
  toKnowledgeCitations,
  toWorkflowCitations,
} from '@/agent/langgraph/rag.utils';
import type {
  RagStopReason,
  RagWorkflowInput,
  RagWorkflowState,
  RetrievalHistoryItem,
} from '@/agent/types/rag-workflow.types';
import type { ConversationMessage } from '@/conversation/entities/conversation-message.entity';
import type { KnowledgeChunk as RetrievedKnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import type { Persona } from '@/persona/persona.entity';

export const RagGraphStateAnnotation = Annotation.Root({
  // ── 1. 基础输入 (Input Fields) ──────────────────────────────────────────────
  /** 当前会话 UUID */
  conversationId: Annotation<string>(),
  /** 关联的角色 UUID */
  personaId: Annotation<string>(),
  /** 用户本次发起的原始提问内容 */
  question: Annotation<string>(),
  /** 本轮交互的 Turn 唯一标识 */
  turnId: Annotation<string>(),

  // ── 2. 路由规划 (Routing & Planning) ────────────────────────────────────────
  /** 路由策略，简单检索(simple)、多步复杂检索(complex)、直接日常回复(none) */
  strategy: Annotation<'simple' | 'complex' | 'none'>(),
  /** 选择该路由策略的置信度理由说明 */
  routeReason: Annotation<string>(),
  /** 对复杂提问拆解出来的有序子问题数组 */
  subQuestions: Annotation<string[]>(),
  /** 当前正在执行的子问题索引位置 */
  nextSubIdx: Annotation<number>(),
  /** 最终构建出的当前跳检索关键词或查询句 */
  currentQuery: Annotation<string>(),
  /** 当前多跳检索执行的跳数 (1-indexed) */
  currentHop: Annotation<number>(),
  /** 最大允许的多跳次数 */
  maxHops: Annotation<number>(),

  // ── 3. 检索与融合 (Retrieval & Processing) ──────────────────────────────────
  /** 多路召回获取的原始文档片段集合 */
  documents: Annotation<RetrievedKnowledgeChunk[]>(),
  /** 重排(Rerank)后保留的高相关性候选文档片段 */
  topDocuments: Annotation<RetrievedKnowledgeChunk[]>(),
  /** 融合作答所需的本地核心证据片段 */
  evidenceChunks: Annotation<RetrievedKnowledgeChunk[]>(),
  /** 网页检索结果生成的引文结构 */
  webCitations: Annotation<RagWorkflowState['webCitations']>(),
  /** 多跳检索的历史记录，防止死循环并做路径追溯 */
  retrievalHistory: Annotation<RetrievalHistoryItem[]>(),
  /** 记录检索的中间调试参数与链路 Trace */
  retrievalTrace: Annotation<RagWorkflowState['retrievalTrace']>(),
  /** 记录图谱推理命中的实体、扩展切片与异常信息 */
  graphReasoningTrace: Annotation<RagWorkflowState['graphReasoningTrace']>(),
  /** Redis 短期记忆：最近窗口、摘要和当前任务背景 */
  shortTermMemory: Annotation<RagWorkflowState['shortTermMemory']>(),
  /** 长期记忆召回结果 */
  longTermMemories: Annotation<RagWorkflowState['longTermMemories']>(),
  /** 已按规则分区后的记忆上下文 */
  memoryContext: Annotation<string>(),
  /** 动态判断后选择的检索召回策略配置 */
  retrievalStrategy: Annotation<RagWorkflowState['retrievalStrategy']>(),
  /** 动态生成该检索策略的推理说明 */
  retrievalStrategyReason: Annotation<string>(),
  /** 路由级是否允许联网（跨 hop 保持，不被单跳 strategy 覆盖） */
  routeAllowWeb: Annotation<boolean>(),
  /** 工作流开始时间戳（ms），用于 wall-clock budget */
  workflowStartedAt: Annotation<number>(),
  /** 单轮工作流最大耗时（ms） */
  workflowBudgetMs: Annotation<number>(),
  /** 执行剖面 id */
  profileId: Annotation<RagWorkflowState['profileId']>(),
  /** 是否允许图一跳扩展 */
  useGraphExpand: Annotation<boolean>(),
  evaluateMode: Annotation<RagWorkflowState['evaluateMode']>(),
  rerankMode: Annotation<RagWorkflowState['rerankMode']>(),

  // ── 4. 证据评估 (Evidence Evaluation) ───────────────────────────────────────
  /** 证据充足性评估结果，true 表示已足够作答 */
  enough: Annotation<boolean | null>(),
  /** 当前证据无法回答问题时，所缺失的关键事实描述列表 */
  missingFacts: Annotation<string[]>(),
  /** 评估器给出当前充分性结论的评语与论据 */
  evaluationReason: Annotation<string>(),

  // ── 5. 网页搜索回退 (Web Fallback Search) ────────────────────────────────────
  /** 基于缺失事实生成的联网搜索 Query */
  webQuery: Annotation<string>(),
  /** 标记本轮工作流是否发起过网络检索 */
  webSearchAttempted: Annotation<boolean>(),
  /** 标记本工作流最终是否采信并使用了联网检索的数据 */
  webSearchUsed: Annotation<boolean>(),
  /** 当前已执行的网页搜索重试次数 */
  webSearchAttempts: Annotation<number>(),
  /** 允许的最大网页搜索重试次数 */
  maxWebSearchAttempts: Annotation<number>(),
  /** 历史发起的网页检索词汇总，避免重复检索 */
  webSearchQueries: Annotation<string[]>(),

  // ── 6. 终结与输出 (Output & Termination) ────────────────────────────────────
  /** 工作流退出原因 (如: enough, max_hops_reached, none_strategy) */
  stopReason: Annotation<RagStopReason>(),
  /** 协调器架构标识，当前固定为 langgraph */
  orchestrator: Annotation<'langgraph'>(),
  /** 最终大模型生成的答复文本 */
  answerText: Annotation<string>(),

  // ── 7. 配置与静态上下文 (Config & Context) ──────────────────────────────────
  /** 重排阶段截断的最大阈值条数 */
  rerankLimit: Annotation<number>(),
  /** 当前关联的角色 entity 详情 */
  persona: Annotation<Persona | null>(),
  /** 历史多轮聊天消息上下文，用于上下文补全 */
  history: Annotation<ConversationMessage[]>(),
});

export type RagGraphState = typeof RagGraphStateAnnotation.State;

export function getRagWorkflowCitations(
  state: Pick<
    RagGraphState,
    'documents' | 'topDocuments' | 'evidenceChunks' | 'webCitations'
  >,
) {
  return toWorkflowCitations(state);
}

export function buildInitialRagGraphState(
  input: RagWorkflowInput,
  history: ConversationMessage[] = [],
): RagGraphState {
  const profile = getRagProfile(input.profileId);
  const maxHops = input.maxHops ?? profile.maxHops ?? DEFAULT_RAG_MAX_HOPS;
  return {
    conversationId: input.conversationId,
    personaId: input.personaId,
    question: input.question,
    turnId: input.turnId,
    strategy: 'simple',
    routeReason: '尚未执行路由',
    subQuestions: [],
    nextSubIdx: 0,
    currentQuery: '',
    currentHop: 0,
    maxHops,
    documents: [],
    topDocuments: [],
    evidenceChunks: [],
    webCitations: [],
    retrievalHistory: [],
    retrievalTrace: [],
    graphReasoningTrace: [],
    shortTermMemory: {
      window: [],
      summary: '',
      activeContext: '',
    },
    longTermMemories: [],
    memoryContext: '',
    retrievalStrategy: DEFAULT_RETRIEVAL_STRATEGY,
    retrievalStrategyReason: DEFAULT_RETRIEVAL_STRATEGY.reason,
    routeAllowWeb: profile.allowWeb,
    workflowStartedAt: Date.now(),
    workflowBudgetMs: profile.budget.wallClockMs || DEFAULT_RAG_WORKFLOW_BUDGET_MS,
    profileId: profile.id,
    useGraphExpand: profile.useGraphExpand,
    evaluateMode: profile.evaluateMode,
    rerankMode: profile.rerankMode,
    enough: null,
    missingFacts: [],
    evaluationReason: '',
    webQuery: '',
    webSearchAttempted: false,
    webSearchUsed: false,
    webSearchAttempts: 0,
    maxWebSearchAttempts: DEFAULT_RAG_MAX_WEB_SEARCH_ATTEMPTS,
    webSearchQueries: [],
    stopReason: '',
    orchestrator: 'langgraph',
    rerankLimit: DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.rerankLimit,
    answerText: '',
    persona: null,
    history,
  };
}

export function toRagWorkflowState(state: RagGraphState): RagWorkflowState {
  const {
    answerText: _answerText,
    persona: _persona,
    history: _history,
    ...workflowState
  } = state;

  return {
    ...workflowState,
    currentQuery: getCurrentQuery(state),
    evidenceChunks:
      state.topDocuments.length > 0 ? state.topDocuments : state.evidenceChunks,
    localCitations: toKnowledgeCitations(
      state.topDocuments.length > 0 ? state.topDocuments : state.evidenceChunks,
    ),
    citations: getRagWorkflowCitations(state),
  };
}
