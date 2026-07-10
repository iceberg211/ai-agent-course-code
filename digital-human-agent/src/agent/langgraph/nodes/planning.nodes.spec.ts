import { createRouteQuestionNode } from '@/agent/langgraph/nodes/planning.nodes';

describe('createRouteQuestionNode', () => {
  it('none 路由进入 load_context 保留人设，跳过记忆与检索', async () => {
    const ragRouteService = {
      routeQuestion: jest.fn().mockResolvedValue({
        strategy: 'none',
        reason: '寒暄',
      }),
    };
    const node = createRouteQuestionNode(ragRouteService as never);
    const command = await node(
      { question: '你好', routeMode: 'heuristic' } as never,
      {
        configurable: {
          workflowInput: { signal: new AbortController().signal },
        },
      } as never,
    );

    expect(ragRouteService.routeQuestion).toHaveBeenCalledWith(
      '你好',
      expect.any(AbortSignal),
      { mode: 'heuristic' },
    );
    expect(command.goto).toEqual(['load_context']);
    expect(command.update).toEqual({
      strategy: 'none',
      routeReason: '寒暄',
    });
  });

  it('complex 路由先 plan_sub_questions', async () => {
    const ragRouteService = {
      routeQuestion: jest.fn().mockResolvedValue({
        strategy: 'complex',
        reason: '多步',
      }),
    };
    const node = createRouteQuestionNode(ragRouteService as never);
    const command = await node(
      { question: '复杂问题' } as never,
      {
        configurable: {
          workflowInput: { signal: new AbortController().signal },
        },
      } as never,
    );

    expect(command.goto).toEqual(['plan_sub_questions']);
  });

  it('simple 路由先加载检索历史，再进入检索', async () => {
    const ragRouteService = {
      routeQuestion: jest.fn().mockResolvedValue({
        strategy: 'simple',
        reason: '直接问题',
      }),
    };
    const node = createRouteQuestionNode(ragRouteService as never);
    const command = await node(
      { question: '乔峰是谁' } as never,
      {
        configurable: {
          workflowInput: { signal: new AbortController().signal },
        },
      } as never,
    );

    expect(command.goto).toEqual(['load_query_history']);
  });
});
