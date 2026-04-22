import { createLoadContextNode } from '@/agent/langgraph/nodes/load-context.node';

describe('createLoadContextNode', () => {
  function buildWorkflowInput(turnId: string) {
    return {
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '当前问题',
      turnId,
      signal: new AbortController().signal,
      onToken: jest.fn(),
      onCitations: jest.fn(),
    };
  }

  it('不会把当前 turn 的消息回灌到提示词 history', async () => {
    const persona = { id: 'persona-1', name: '乔峰' };
    const history = [
      { turnId: 'turn-1', role: 'user', content: '上一轮问题' },
      { turnId: 'turn-1', role: 'assistant', content: '上一轮回答' },
      { turnId: 'turn-2', role: 'user', content: '当前问题' },
    ];
    const personaService = {
      findOne: jest.fn().mockResolvedValue(persona),
    };
    const conversationService = {
      getCompletedMessages: jest.fn().mockResolvedValue(history),
    };
    const node = createLoadContextNode(
      personaService as never,
      conversationService as never,
    );

    const result = await node(
      {} as never,
      {
        context: {
          workflowInput: buildWorkflowInput('turn-2'),
        },
      } as never,
    );

    expect(conversationService.getCompletedMessages).toHaveBeenCalledWith(
      'conv-1',
      10,
    );
    expect(result.persona).toEqual(persona);
    expect(result.history).toEqual(history.slice(0, 2));
  });

  it('会丢弃末尾没有 assistant 响应的历史用户消息', async () => {
    const history = [
      { turnId: 'turn-1', role: 'user', content: '第一轮问题' },
      { turnId: 'turn-1', role: 'assistant', content: '第一轮回答' },
      { turnId: 'turn-2', role: 'user', content: '中断后残留的问题' },
    ];
    const personaService = {
      findOne: jest.fn().mockResolvedValue({ id: 'persona-1' }),
    };
    const conversationService = {
      getCompletedMessages: jest.fn().mockResolvedValue(history),
    };
    const node = createLoadContextNode(
      personaService as never,
      conversationService as never,
    );

    const result = await node(
      {} as never,
      {
        context: {
          workflowInput: buildWorkflowInput('turn-3'),
        },
      } as never,
    );

    expect(result.history).toEqual(history.slice(0, 2));
  });
});
