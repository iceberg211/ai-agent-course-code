import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { HealthService } from './health.service';
import { DIGITAL_HUMAN_PROVIDER } from '@/common/constants';
import { ElasticsearchIndexService } from '@/knowledge/elasticsearch/elasticsearch-index.service';
import { Neo4jGraphService } from '@/knowledge/graph/neo4j-graph.service';
import { QueueService } from '@/queue/queue.service';
import { ObjectStorageProviderToken } from '@/storage/object-storage.provider';

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    return {
      ping: jest.fn().mockResolvedValue('PONG'),
      get: jest.fn().mockResolvedValue(Date.now().toString()), // 心跳正常
      disconnect: jest.fn(),
    };
  });
});

describe('HealthService', () => {
  let service: HealthService;

  const mockDataSource = {
    query: jest.fn().mockResolvedValue([{ 1: 1 }]),
    getRepository: jest.fn().mockReturnValue({
      findOne: jest.fn().mockResolvedValue({ updatedAt: new Date() }),
    }),
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key) => {
      if (key === 'REDIS_URL') return 'redis://mock-host:6379';
      if (key === 'MODEL_NAME') return 'gpt-4o';
      if (key === 'OPENAI_API_KEY') return 'sk-mock';
      return '';
    }),
  };

  const mockDigitalHumanProvider = {
    healthCheck: jest.fn().mockResolvedValue({ status: 'ok' }),
  };

  const mockEsService = {
    getClient: jest.fn().mockReturnValue({
      ping: jest.fn().mockResolvedValue(true),
    }),
  };

  const mockNeo4jService = {
    isEnabled: jest.fn().mockReturnValue(true),
    verifyConnectivity: jest.fn().mockResolvedValue(true),
  };

  const mockQueueService = {
    getQueue: jest.fn().mockReturnValue({
      getWaitingCount: jest.fn().mockResolvedValue(3),
    }),
  };

  const mockStorageProvider = {
    healthCheck: jest.fn().mockResolvedValue({ status: 'ok' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: DIGITAL_HUMAN_PROVIDER, useValue: mockDigitalHumanProvider },
        { provide: ElasticsearchIndexService, useValue: mockEsService },
        { provide: Neo4jGraphService, useValue: mockNeo4jService },
        { provide: QueueService, useValue: mockQueueService },
        { provide: ObjectStorageProviderToken, useValue: mockStorageProvider },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('当所有服务都正常时，check() 应该返回 status = ok 并包含所有检查细节', async () => {
    const result = await service.check();
    expect(result.status).toBe('ok');
    expect(result.checks.db.status).toBe('ok');
    expect(result.checks.elasticsearch.status).toBe('ok');
    expect(result.checks.neo4j.status).toBe('ok');
    expect(result.checks.redis.status).toBe('ok');
    expect(result.checks.redis.queueDelayCount).toBe(3);
    expect(result.checks.minio.status).toBe('ok');
    expect(result.checks.worker.status).toBe('ok');
  });

  it('当某个服务异常时，check() 应该返回 status = error', async () => {
    mockNeo4jService.verifyConnectivity.mockRejectedValueOnce(new Error('Neo4j connection timeout'));
    const result = await service.check();
    expect(result.status).toBe('error');
    expect(result.checks.neo4j.status).toBe('error');
    expect(result.checks.neo4j.message).toContain('Neo4j connection timeout');
  });
});
