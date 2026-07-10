import { KnowledgeCacheRevisionService } from '@/common/rag/knowledge-cache-revision.service';

describe('KnowledgeCacheRevisionService', () => {
  it('读取并递增知识库缓存版本', async () => {
    const redis = {
      mget: jest.fn().mockResolvedValue(['11', null]),
      incr: jest.fn().mockResolvedValue(12),
    };
    const redisService = {
      ensureConnected: jest.fn().mockResolvedValue(redis),
    };
    const service = new KnowledgeCacheRevisionService(redisService as never);

    await expect(service.getRevisions(['kb-2', 'kb-1'])).resolves.toEqual({
      'kb-1': 11,
      'kb-2': 0,
    });
    await service.bumpRevision('kb-1');

    expect(redis.mget).toHaveBeenCalledWith([
      'kb:kb-1:retrieval_revision',
      'kb:kb-2:retrieval_revision',
    ]);
    expect(redis.incr).toHaveBeenCalledWith('kb:kb-1:retrieval_revision');
  });
});
