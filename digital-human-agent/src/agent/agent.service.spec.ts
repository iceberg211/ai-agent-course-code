import type { RagWorkflowState } from '@/agent/types/rag-workflow.types';
import { AgentService } from '@/agent/agent.service';

describe('AgentService', () => {
  it('会把请求转发给 orchestrator，并保留现有 run 签名', async () => {
    const orchestrator = {
      run: jest.fn().mockResolvedValue({
        state: {
          conversationId: 'conv-1',
          personaId: 'persona-1',
          question: '你好',
          turnId: 'turn-1',
          strategy: 'simple',
          routeReason: '直接问题',
          subQuestions: [],
          currentQuery: '你好',
          currentHop: 1,
          maxHops: 3,
          evidenceChunks: [],
          localCitations: [],
          webCitations: [],
          citations: [],
          retrievalHistory: [],
          enough: true,
          missingFacts: [],
          evaluationReason: '证据足够',
          webQuery: '',
          webSearchAttempted: false,
          webSearchUsed: false,
          stopReason: 'single_hop_enough',
          orchestrator: 'langgraph',
        } satisfies RagWorkflowState,
        citations: [],
        answerText: '你好',
      }),
    };

    const service = new AgentService(orchestrator as never);
    const onToken = jest.fn();
    const onCitations = jest.fn();

    await service.run({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      userMessage: '你好',
      turnId: 'turn-1',
      signal: new AbortController().signal,
      onToken,
      onCitations,
    });

    expect(orchestrator.run).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        personaId: 'persona-1',
        question: '你好',
        turnId: 'turn-1',
        onToken,
        onCitations,
      }),
    );
  });
});
