import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { DIGITAL_HUMAN_PROVIDER } from '@/common/constants';
import type { DigitalHumanProvider } from '@/digital-human/digital-human.types';
import { HealthProbeResult, HealthResponse } from '@/health/health.types';
import { ElasticsearchIndexService } from '@/knowledge/elasticsearch/elasticsearch-index.service';
import { Neo4jGraphService } from '@/knowledge/graph/neo4j-graph.service';
import { QueueService } from '@/queue/queue.service';
import { ObjectStorageProviderToken, ObjectStorageProvider } from '@/storage/object-storage.provider';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';

@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    @Inject(DIGITAL_HUMAN_PROVIDER)
    private readonly digitalHumanProvider: DigitalHumanProvider,
    @Optional()
    private readonly esService?: ElasticsearchIndexService,
    @Optional()
    private readonly neo4jService?: Neo4jGraphService,
    @Optional()
    private readonly queueService?: QueueService,
    @Optional()
    @Inject(ObjectStorageProviderToken)
    private readonly storageProvider?: ObjectStorageProvider,
  ) {}

  async check(): Promise<HealthResponse> {
    const checks: Record<string, HealthProbeResult & Record<string, any>> = {
      app: { status: 'ok' },
      db: await this.checkDb(),
      elasticsearch: await this.checkElasticsearch(),
      neo4j: await this.checkNeo4j(),
      redis: await this.checkRedis(),
      minio: await this.checkMinio(),
      worker: await this.checkWorker(),
      digitalHuman: await this.checkDigitalHuman(),
      llm: this.checkLlm(),
    };

    const status = Object.values(checks).some((item) => item.status === 'error')
      ? 'error'
      : 'ok';

    return {
      status,
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private async checkDb(): Promise<HealthProbeResult> {
    const startedAt = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      return {
        status: 'ok',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async checkElasticsearch(): Promise<HealthProbeResult> {
    if (!this.esService) {
      return { status: 'error', message: 'ElasticsearchIndexService 未注入' };
    }
    const client = this.esService.getClient();
    if (!client) {
      return { status: 'error', message: 'Elasticsearch 客户端未初始化' };
    }
    const startedAt = Date.now();
    try {
      await client.ping();
      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async checkNeo4j(): Promise<HealthProbeResult> {
    if (!this.neo4jService || !this.neo4jService.isEnabled()) {
      return { status: 'error', message: 'Neo4j 服务未启用' };
    }
    const startedAt = Date.now();
    try {
      await this.neo4jService.verifyConnectivity();
      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async checkRedis(): Promise<HealthProbeResult & Record<string, any>> {
    const redisUrl =
      this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    const startedAt = Date.now();
    let redis: Redis | null = null;
    try {
      redis = new Redis(redisUrl, { maxRetriesPerRequest: null, connectTimeout: 3000 });
      await redis.ping();
      const latencyMs = Date.now() - startedAt;

      let queueDelayCount = 0;
      if (this.queueService) {
        const q = this.queueService.getQueue('document-processing');
        queueDelayCount = await q.getWaitingCount();
      }

      return { status: 'ok', latencyMs, queueDelayCount };
    } catch (error) {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (redis) redis.disconnect();
    }
  }

  private async checkMinio(): Promise<HealthProbeResult> {
    if (!this.storageProvider || !this.storageProvider.healthCheck) {
      return { status: 'error', message: 'StorageProvider 未初始化或不支持 healthCheck' };
    }
    const startedAt = Date.now();
    try {
      const res = await this.storageProvider.healthCheck();
      return {
        status: res.status,
        latencyMs: Date.now() - startedAt,
        message: res.message,
      };
    } catch (error) {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async checkWorker(): Promise<HealthProbeResult & Record<string, any>> {
    const redisUrl =
      this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    let redis: Redis | null = null;
    try {
      redis = new Redis(redisUrl, { maxRetriesPerRequest: null, connectTimeout: 3000 });
      const heartbeat = await redis.get('worker:heartbeat');

      let status: 'ok' | 'error' = 'error';
      let message = 'Worker 心跳未检测到，可能未启动';
      if (heartbeat) {
        const diff = Date.now() - Number(heartbeat);
        if (diff < 15000) {
          status = 'ok';
          message = 'Worker 正常存活';
        } else {
          message = `Worker 心跳超时，最近更新在 ${Math.round(diff / 1000)} 秒前`;
        }
      }

      let lastTaskProcessedAt: string | null = null;
      try {
        const latestDoc = await this.dataSource.getRepository(KnowledgeDocument).findOne({
          where: {},
          order: { updatedAt: 'DESC' },
        });
        if (latestDoc) {
          lastTaskProcessedAt = latestDoc.updatedAt.toISOString();
        }
      } catch (dbErr) {
        // 忽略 DB 错误
      }

      return {
        status,
        message,
        lastTaskProcessedAt,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (redis) redis.disconnect();
    }
  }

  private async checkDigitalHuman(): Promise<HealthProbeResult> {
    const startedAt = Date.now();
    try {
      if (!this.digitalHumanProvider.healthCheck) {
        return { status: 'ok', latencyMs: Date.now() - startedAt };
      }
      const result = await this.digitalHumanProvider.healthCheck();
      return {
        status: result.status,
        message: result.message,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private checkLlm(): HealthProbeResult {
    const modelName = (
      this.configService.get<string>('MODEL_NAME') ?? ''
    ).trim();
    const hasApiKey =
      Boolean((this.configService.get<string>('OPENAI_API_KEY') ?? '').trim());
    if (!modelName || !hasApiKey) {
      return {
        status: 'error',
        message: 'MODEL_NAME 或 LLM API Key 缺失',
      };
    }
    return {
      status: 'ok',
    };
  }
}
