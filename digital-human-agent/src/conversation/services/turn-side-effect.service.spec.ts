import { TurnSideEffectService } from '@/conversation/services/turn-side-effect.service';

describe('TurnSideEffectService', () => {
  function createService() {
    const conversationService = {
      addMessage: jest.fn().mockResolvedValue(undefined),
    };
    const shortTermMemoryService = {
      appendMessage: jest.fn().mockResolvedValue(undefined),
      refreshSummaryFromWindow: jest.fn().mockResolvedValue(undefined),
      setActiveContext: jest.fn().mockResolvedValue(undefined),
    };
    const longTermMemoryService = {
      captureFromConversation: jest.fn().mockResolvedValue(null),
    };
    const service = new TurnSideEffectService(
      conversationService as never,
      shortTermMemoryService as never,
      longTermMemoryService as never,
    );
    return {
      service,
      conversationService,
      shortTermMemoryService,
      longTermMemoryService,
    };
  }

  it('onTurnStart 落库 user 并写入短期记忆', async () => {
    const { service, conversationService, shortTermMemoryService } =
      createService();

    const flags = await service.onTurnStart({
      conversationId: 'conv-1',
      turnId: 'turn-1',
      userMessage: '你好',
    });

    expect(flags).toEqual([]);
    expect(conversationService.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        turnId: 'turn-1',
        role: 'user',
        content: '你好',
        status: 'completed',
      }),
    );
    expect(shortTermMemoryService.appendMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        role: 'user',
        content: '你好',
        turnId: 'turn-1',
      }),
    );
  });

  it('onTurnEnd 落库 assistant 并合并记忆副作用 degradationFlags', async () => {
    const {
      service,
      conversationService,
      shortTermMemoryService,
      longTermMemoryService,
    } = createService();

    shortTermMemoryService.appendMessage
      .mockRejectedValueOnce(new Error('redis down'));

    await service.onTurnEnd({
      conversationId: 'conv-1',
      turnId: 'turn-1',
      userMessage: '你好',
      assistantReply: '您好',
      status: 'completed',
      citations: [],
      ragTrace: {
        profileId: 'balanced_chat',
        degradationFlags: ['route_heuristic'],
      },
      latencyMs: 120,
      ownerId: 'owner-1',
      department: '研发部',
      sideEffectFlags: ['side_effect_user_memory_failed'],
    });

    expect(conversationService.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'assistant',
        content: '您好',
        status: 'completed',
        latencyMs: 120,
        ragTrace: expect.objectContaining({
          degradationFlags: expect.arrayContaining([
            'route_heuristic',
            'side_effect_memory_failed',
            'side_effect_user_memory_failed',
          ]),
        }),
      }),
    );
    expect(longTermMemoryService.captureFromConversation).not.toHaveBeenCalled();
  });

  it('onTurnEnd 成功时写入记忆与 LTM', async () => {
    const {
      service,
      shortTermMemoryService,
      longTermMemoryService,
    } = createService();

    await service.onTurnEnd({
      conversationId: 'conv-1',
      turnId: 'turn-1',
      userMessage: '你好',
      assistantReply: '您好',
      status: 'completed',
      citations: [],
      ragTrace: { profileId: 'balanced_chat' },
      latencyMs: 120,
      ownerId: 'owner-1',
      department: '研发部',
    });

    expect(shortTermMemoryService.appendMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        role: 'assistant',
        content: '您好',
        turnId: 'turn-1',
      }),
    );
    expect(shortTermMemoryService.refreshSummaryFromWindow).toHaveBeenCalledWith(
      'conv-1',
    );
    expect(shortTermMemoryService.setActiveContext).toHaveBeenCalledWith(
      'owner-1',
      expect.stringContaining('你好'),
    );
    expect(longTermMemoryService.captureFromConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner-1',
        conversationId: 'conv-1',
        userMessage: '你好',
        assistantMessage: '您好',
      }),
    );
  });

  it('onTurnEnd 无回复且 interrupted 时默认不落库', async () => {
    const { service, conversationService, shortTermMemoryService } =
      createService();

    await service.onTurnEnd({
      conversationId: 'conv-1',
      turnId: 'turn-1',
      userMessage: '你好',
      assistantReply: '',
      status: 'interrupted',
      citations: [],
      ragTrace: null,
      latencyMs: 10,
      ownerId: 'owner-1',
    });

    expect(conversationService.addMessage).not.toHaveBeenCalled();
    expect(shortTermMemoryService.appendMessage).not.toHaveBeenCalled();
  });
});
