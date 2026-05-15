import { createEvaluateEvidenceNode } from '@/agent/langgraph/nodes/evaluate-evidence.node';
import { createPrepareQueryNode } from '@/agent/langgraph/nodes/retrieve.node';
import type { RagGraphState } from '@/agent/langgraph/rag.state';

describe('retrieval strategy web routing', () => {
  const baseState = {
    conversationId: 'conv-1',
    personaId: 'persona-1',
    question: '需要外部事实的问题',
    turnId: 'turn-1',
    strategy: 'complex',
    routeReason: '需要多跳',
    subQuestions: ['第一问'],
    currentHop: 1,
    maxHops: 1,
    evidenceChunks: [],
    webCitations: [],
    retrievalHistory: [],
    retrievalStrategy: {
      needRetrieval: true,
      useVector: true,
      useKeyword: true,
      useGraph: false,
      useExactPhrase: false,
      useMultiQuery: true,
      useHyDE: false,
      allowWeb: false,
      reason: '禁止联网补充',
    },
    retrievalStrategyReason: '禁止联网补充',
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

  it('prepare_query 在 allowWeb=false 时不会进入 web_fallback', () => {
    const node = createPrepareQueryNode({
      isEnabled: jest.fn(() => true),
    } as never);

    const command = node(baseState);

    expect(command.goto).toEqual(['load_context']);
    expect(command.update).toMatchObject({
      stopReason: 'web_fallback_disabled',
    });
  });

  it('evaluate_evidence 在 allowWeb=false 时不会进入 web_fallback', async () => {
    const node = createEvaluateEvidenceNode(
      {
        evaluate: jest.fn().mockResolvedValue({
          enough: false,
          missingFacts: ['缺少外部事实'],
          reason: '本地证据不足',
          webQuery: '外部事实查询',
        }),
      } as never,
      {
        isEnabled: jest.fn(() => true),
      } as never,
    );

    const command = await node(
      {
        ...baseState,
        strategy: 'simple',
        subQuestions: [],
        currentHop: 1,
        maxHops: 1,
      },
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(command.goto).toEqual(['load_context']);
    expect(command.update).toMatchObject({
      enough: false,
      stopReason: 'web_fallback_disabled',
      webQuery: '外部事实查询',
    });
  });

  it('evaluate_evidence 在 needRetrieval=false 时不评估空证据', async () => {
    const evidenceEvaluatorService = {
      evaluate: jest.fn().mockResolvedValue({
        enough: false,
        missingFacts: ['不应该被评估'],
        reason: '不应该发生',
        webQuery: '',
      }),
    };
    const node = createEvaluateEvidenceNode(
      evidenceEvaluatorService as never,
      {
        isEnabled: jest.fn(() => true),
      } as never,
    );

    const command = await node(
      {
        ...baseState,
        question: '你好',
        strategy: 'simple',
        routeReason: '寒暄问题',
        subQuestions: [],
        currentHop: 0,
        maxHops: 3,
        retrievalStrategy: {
          needRetrieval: false,
          useVector: false,
          useKeyword: false,
          useGraph: false,
          useExactPhrase: false,
          useMultiQuery: false,
          useHyDE: false,
          allowWeb: false,
          reason: '寒暄问题，不需要查知识库',
        },
        retrievalStrategyReason: '寒暄问题，不需要查知识库',
        stopReason: 'retrieval_skipped',
      },
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(evidenceEvaluatorService.evaluate).not.toHaveBeenCalled();
    expect(command.goto).toEqual(['load_context']);
    expect(command.update).toMatchObject({
      enough: true,
      missingFacts: [],
      evaluationReason: '寒暄问题，不需要查知识库',
      stopReason: 'retrieval_skipped',
    });
  });
});
