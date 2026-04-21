import { ConversationService } from '@/conversation/conversation.service';

describe('ConversationService', () => {
  function createService() {
    const convRepo = {
      save: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
    };
    const msgRepo = {
      save: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
    };

    return {
      service: new ConversationService(convRepo as never, msgRepo as never),
      convRepo,
      msgRepo,
    };
  }

  it('getCompletedMessages 会返回最近 N 条 completed 消息，并保持时间正序', async () => {
    const { service, msgRepo } = createService();
    const newest = { id: '3', content: '第三条' };
    const middle = { id: '2', content: '第二条' };
    const oldest = { id: '1', content: '第一条' };

    msgRepo.find.mockResolvedValue([newest, middle, oldest]);

    await expect(service.getCompletedMessages('conv-1', 3)).resolves.toEqual([
      oldest,
      middle,
      newest,
    ]);
    expect(msgRepo.find).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', status: 'completed' },
      order: { createdAt: 'DESC' },
      take: 3,
    });
  });
});
