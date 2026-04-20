import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { DIGITAL_HUMAN_PROVIDER } from '@/digital-human/digital-human.constants';
import type { DigitalHumanProvider } from '@/digital-human/digital-human.types';
import { HealthProbeResult, HealthResponse } from '@/health/health.types';

@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    @Inject(DIGITAL_HUMAN_PROVIDER)
    private readonly digitalHumanProvider: DigitalHumanProvider,
  ) {}

  async check(): Promise<HealthResponse> {
    const checks = {
      app: { status: 'ok' } as HealthProbeResult,
      db: await this.checkDb(),
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
    const modelName = (this.configService.get<string>('MODEL_NAME') ?? '').trim();
    const hasApiKey =
      Boolean((this.configService.get<string>('OPENAI_API_KEY') ?? '').trim()) ||
      Boolean((this.configService.get<string>('DASHSCOPE_API_KEY') ?? '').trim());
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

