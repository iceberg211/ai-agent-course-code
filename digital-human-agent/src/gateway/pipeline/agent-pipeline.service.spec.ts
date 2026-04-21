import { WebSocket } from 'ws';
import { AgentPipelineService } from '@/gateway/pipeline/agent-pipeline.service';
import type { RealtimeSession } from '@/realtime-session/realtime-session.interface';

describe('AgentPipelineService', () => {
  function createSession(): RealtimeSession {
    return {
      sessionId: 'session-1',
      conversationId: 'conv-1',
      personaId: 'persona-1',
      mode: 'voice',
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

  it('AbortError 时也会落库 interrupted 消息并发送 conversation:done', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';

    const agentService = {
      run: jest.fn().mockImplementation(async (params) => {
        params.onToken('半句');
        throw abortError;
      }),
    };
    const conversationService = {
      addMessage: jest.fn().mockResolvedValue(undefined),
    };
    const sessionRegistry = {
      update: jest.fn(),
    };
    const ttsPipeline = {
      enqueue: jest.fn(),
      markFinalize: jest.fn(),
    };
    const speakPipeline = {
      enqueue: jest.fn(),
      markFinalize: jest.fn(),
    };

    const service = new AgentPipelineService(
      agentService as never,
      conversationService as never,
      sessionRegistry as never,
      ttsPipeline as never,
      speakPipeline as never,
    );

    const client = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
    } as unknown as WebSocket;

    const session = createSession();
    await service.run(client, session, '你好', 'turn-1');

    expect(conversationService.addMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      turnId: 'turn-1',
      role: 'assistant',
      seq: 0,
      content: '半句',
      status: 'interrupted',
    });

    const sentMessages = (client.send as jest.Mock).mock.calls.map(
      ([payload]) => JSON.parse(String(payload)),
    );

    expect(sentMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'conversation:start' }),
        expect.objectContaining({ type: 'conversation:text_chunk' }),
        expect.objectContaining({
          type: 'conversation:done',
          payload: { status: 'interrupted' },
        }),
      ]),
    );
    expect(sentMessages.some((message) => message.type === 'error')).toBe(
      false,
    );
    expect(ttsPipeline.markFinalize).toHaveBeenCalled();
  });
});
