import { createEvaluateEvidenceNode } from '@/agent/langgraph/nodes/evaluate-evidence.node';
import type { RagGraphState } from '@/agent/langgraph/rag.state';

describe('createEvaluateEvidenceNode', () => {
  const baseState = {
    conversationId: 'conv-1',
    personaId: 'persona-1',
    question: '合同删除条款和审计要求是什么？',
    turnId: 'turn-1',
    strategy: 'complex',
    routeReason: '需要多跳检索',
    subQuestions: ['合同删除条款是什么？'],
    currentHop: 1,
    maxHops: 3,
    evidenceChunks: [
      {
        id: 'chunk-1',
        content: '合同第七条说明试用数据删除时限。',
        source: 'contract.md',
        chunk_index: 7,
        category: null,
        similarity: 0.9,
      },
    ],
    webCitations: [],
    retrievalHistory: [
      {
        query: '合同删除条款是什么？',
        resultCount: 1,
      },
    ],
    retrievalStrategy: {
      needRetrieval: true,
      useVector: true,
      useKeyword: true,
      useGraph: false,
      useExactPhrase: true,
      useMultiQuery: true,
      allowWeb: true,
      reason: '需要知识库事实',
    },
    retrievalStrategyReason: '需要知识库事实',
    enough: null,
    missingFacts: [],
    evaluationReason: '',
    webQuery: '',
    webSearchAttempted: false,
    webSearchUsed: false,
    webSearchAttempts: 0,
    maxWebSearchAttempts: 2,
    webSearchQueries: [],
    stopReason: '',
    orchestrator: 'langgraph',
    answerText: '',
    persona: null,
    history: [],
  } satisfies RagGraphState;

  it('证据不足且还有跳数时，把 missingFacts 追加为下一条本地检索问题', async () => {
    const evidenceEvaluatorService = {
      evaluate: jest.fn().mockResolvedValue({
        enough: false,
        missingFacts: ['审计保留要求是什么？'],
        reason: '缺少审计保留要求',
        webQuery: '合同 审计 保留 要求',
      }),
    };
    const webFallbackService = {
      isEnabled: jest.fn().mockReturnValue(true),
    };
    const node = createEvaluateEvidenceNode(
      evidenceEvaluatorService as never,
      webFallbackService as never,
    );

    const command = await node(baseState, {
      configurable: {
        workflowInput: {
          signal: new AbortController().signal,
        },
      },
    } as never);

    expect(command.goto).toEqual(['prepare_query']);
    expect(command.update).toMatchObject({
      enough: false,
      missingFacts: ['审计保留要求是什么？'],
      subQuestions: ['合同删除条款是什么？', '审计保留要求是什么？'],
      stopReason: 'multi_hop_insufficient',
    });
  });

  it('已用过一次 web 但评估仍不足且给出新 query 时，会再次进入 web fallback', async () => {
    const evidenceEvaluatorService = {
      evaluate: jest.fn().mockResolvedValue({
        enough: false,
        missingFacts: ['监管更新时间是什么？'],
        reason: '第一次联网后仍缺少监管更新时间',
        webQuery: '合同 审计 监管 更新时间',
      }),
    };
    const webFallbackService = {
      isEnabled: jest.fn().mockReturnValue(true),
    };
    const node = createEvaluateEvidenceNode(
      evidenceEvaluatorService as never,
      webFallbackService as never,
    );

    const command = await node(
      {
        ...baseState,
        strategy: 'simple',
        subQuestions: [],
        currentHop: 1,
        maxHops: 1,
        webSearchAttempted: true,
        webSearchUsed: true,
        webSearchAttempts: 1,
        maxWebSearchAttempts: 2,
        webSearchQueries: ['合同 审计 保留 要求'],
      } as RagGraphState,
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(command.goto).toEqual(['web_fallback']);
    expect(command.update).toMatchObject({
      enough: false,
      webQuery: '合同 审计 监管 更新时间',
      stopReason: 'web_fallback_retry',
    });
  });
});
