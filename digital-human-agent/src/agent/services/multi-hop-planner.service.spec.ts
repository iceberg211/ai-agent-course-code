import { MultiHopPlannerService } from '@/agent/services/multi-hop-planner.service';

describe('MultiHopPlannerService', () => {
  it('复杂问题会规划出有序子问题', async () => {
    const service = new MultiHopPlannerService();
    const invoke = jest.fn().mockResolvedValue({
      subQuestions: ['雁门关事件的主谋是谁？', '这个人的儿子最终结局是什么？'],
      reason: '先找实体，再找结局',
    });

    Reflect.set(service, 'llm', {
      withStructuredOutput: jest.fn().mockReturnValue({
        invoke,
      }),
    });

    await expect(
      service.planSubQuestions('雁门关事件的主谋是谁，他儿子结局是什么？'),
    ).resolves.toEqual({
      subQuestions: ['雁门关事件的主谋是谁？', '这个人的儿子最终结局是什么？'],
      reason: '先找实体，再找结局',
    });
  });

  it('规划失败时会稳定回退为原问题', async () => {
    const service = new MultiHopPlannerService();
    const invoke = jest.fn().mockRejectedValue(new Error('planner failed'));

    Reflect.set(service, 'llm', {
      withStructuredOutput: jest.fn().mockReturnValue({
        invoke,
      }),
    });

    await expect(service.planSubQuestions('萧峰结局是什么？')).resolves.toEqual(
      {
        subQuestions: ['萧峰结局是什么？'],
        reason: '规划失败，暂时回退为原问题单条规划',
      },
    );
  });
});
