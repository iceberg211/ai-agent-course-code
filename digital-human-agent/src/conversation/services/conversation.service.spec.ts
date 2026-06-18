import { ConversationService } from '@/conversation/services/conversation.service';

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
      order: { seq: 'DESC', createdAt: 'DESC' },
      take: 3,
    });
  });

  it('getCompletedMessages 遇到数据库瞬时断连会重试', async () => {
    const { service, msgRepo } = createService();
    const newest = { id: '2', content: '第二条' };
    const oldest = { id: '1', content: '第一条' };

    msgRepo.find
      .mockRejectedValueOnce(new Error('Connection terminated unexpectedly'))
      .mockResolvedValueOnce([newest, oldest]);

    await expect(service.getCompletedMessages('conv-1', 2)).resolves.toEqual([
      oldest,
      newest,
    ]);
    expect(msgRepo.find).toHaveBeenCalledTimes(2);
  });

  it('addMessage 重试时复用同一个消息 id，避免重复写入', async () => {
    const { service, msgRepo } = createService();
    msgRepo.create.mockImplementation((params) => params);
    msgRepo.save
      .mockRejectedValueOnce(new Error('Connection terminated unexpectedly'))
      .mockResolvedValueOnce({ id: 'message-1' });

    await expect(
      service.addMessage({
        conversationId: 'conv-1',
        turnId: 'turn-1',
        role: 'user',
        seq: 0,
        content: '你好',
        status: 'completed',
      }),
    ).resolves.toEqual({ id: 'message-1' });

    expect(msgRepo.save).toHaveBeenCalledTimes(2);
    expect(msgRepo.save.mock.calls[0][0]).toBe(msgRepo.save.mock.calls[1][0]);
    expect(msgRepo.save.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        conversationId: 'conv-1',
        turnId: 'turn-1',
      }),
    );
  });
});
