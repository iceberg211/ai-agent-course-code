import { WebSocket } from 'ws';
import { AgentPipelineService } from '@/gateway/pipeline/agent-pipeline.service';
import type { RealtimeSession } from '@/conversation/interfaces/realtime-session.interface';

describe('AgentPipelineService', () => {
  function createSession(): RealtimeSession {
    return {
      sessionId: 'session-1',
      conversationId: 'conv-1',
      personaId: 'persona-1',
      ownerId: 'owner-1',
      mode: 'voice',
      voiceId: null,
      digitalHumanSessionId: null,
      digitalHumanSpeakMode: null,
      activeTurnId: 'turn-1',
      abortController: null,
      sentenceBuffer: '',
      ttsTurnId: 'turn-1',
      ttsQueue: [],
      ttsProcessing: false,
      ttsSeq: 0,
      ttsStarted: false,
      ttsFinalizeRequested: false,
      speakQueue: [],
      speakProcessing: false,
      wsClientId: 'ws-1',
    };
  }

  function createTurnSideEffects() {
    return {
      buildRagTrace: jest.fn().mockReturnValue({ profileId: 'realtime_voice' }),
      onTurnEnd: jest.fn().mockResolvedValue(undefined),
      onTurnStart: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('AbortError 时也会落库 interrupted 消息并发送 conversation:done', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';

    const agentService = {
      run: jest.fn().mockImplementation(async (params) => {
        params.onToken('半句');
        throw abortError;
      }),
    };
    const session = createSession();
    const sessionRegistry = {
      update: jest.fn().mockImplementation((id, patch) => {
        Object.assign(session, patch);
      }),
      appendToSentenceBuffer: jest.fn().mockImplementation((id, token) => {
        session.sentenceBuffer += token;
      }),
    };
    const ttsPipeline = {
      enqueue: jest.fn(),
      markFinalize: jest.fn(),
    };
    const speakPipeline = {
      enqueue: jest.fn(),
      markFinalize: jest.fn(),
    };
    const turnSideEffects = createTurnSideEffects();

    const service = new AgentPipelineService(
      agentService as never,
      sessionRegistry as never,
      ttsPipeline as never,
      speakPipeline as never,
      turnSideEffects as never,
    );

    const client = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
    } as unknown as WebSocket;

    await service.run(client, session, '你好', 'turn-1', {
      startedAt: 1_700_000_000_000,
    });

    expect(turnSideEffects.onTurnEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        turnId: 'turn-1',
        userMessage: '你好',
        assistantReply: '半句',
        status: 'interrupted',
        citations: [],
        latencyMs: expect.any(Number),
        persistAssistant: true,
      }),
    );

    const sentMessages = (client.send as jest.Mock).mock.calls.map(
      ([payload]) => JSON.parse(String(payload)),
    );

    expect(sentMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'conversation:start' }),
        expect.objectContaining({ type: 'conversation:text_chunk' }),
      ]),
    );
    expect(sentMessages.some((message) => message.type === 'conversation:done')).toBe(
      false,
    );
    expect(sentMessages.some((message) => message.type === 'error')).toBe(
      false,
    );
    expect(ttsPipeline.markFinalize).toHaveBeenCalled();
  });

  it('调用 Agent 时会传递会话里的 accessScope', async () => {
    const agentService = {
      run: jest.fn().mockResolvedValue({
        citations: [],
        state: {
          strategy: 'rag',
          routeReason: '',
          retrievalStrategy: null,
          retrievalStrategyReason: '',
          subQuestions: [],
          retrievalHistory: [],
          retrievalTrace: [],
          enough: true,
          missingFacts: [],
          evaluationReason: '',
          webSearchUsed: false,
          webSearchQueries: [],
          stopReason: 'done',
          orchestrator: 'langgraph',
        },
      }),
    };
    const session = createSession();
    session.accessScope = {
      ownerId: 'owner-1',
      department: '研发部',
      role: 'user',
    };
    const sessionRegistry = {
      update: jest.fn().mockImplementation((id, patch) => {
        Object.assign(session, patch);
      }),
      appendToSentenceBuffer: jest.fn(),
    };
    const ttsPipeline = {
      enqueue: jest.fn(),
      markFinalize: jest.fn(),
    };
    const speakPipeline = {
      enqueue: jest.fn(),
      markFinalize: jest.fn(),
    };
    const turnSideEffects = createTurnSideEffects();
    const service = new AgentPipelineService(
      agentService as never,
      sessionRegistry as never,
      ttsPipeline as never,
      speakPipeline as never,
      turnSideEffects as never,
    );
    const client = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
    } as unknown as WebSocket;

    await service.run(client, session, '你好', 'turn-1');

    expect(agentService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        accessScope: {
          ownerId: 'owner-1',
          department: '研发部',
          role: 'user',
        },
        startedAt: expect.any(Number),
      }),
    );
    expect(turnSideEffects.onTurnEnd).toHaveBeenCalled();
    expect(turnSideEffects.buildRagTrace).toHaveBeenCalled();
  });
});
