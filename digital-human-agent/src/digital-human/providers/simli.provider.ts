import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  DigitalHumanHealthStatus,
  DigitalHumanProvider,
  DigitalHumanSessionInfo,
} from '@/digital-human/digital-human.types';

interface SimliCreateSessionResponse {
  sessionId?: string;
  id?: string;
  session_token?: string;
  sessionToken?: string;
  data?: {
    sessionId?: string;
    session_token?: string;
    sessionToken?: string;
  };
}

@Injectable()
export class SimliProvider implements DigitalHumanProvider {
  readonly name = 'simli';
  private readonly logger = new Logger(SimliProvider.name);
  private readonly apiKey: string;
  private readonly faceId: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = (
      this.configService.get<string>('SIMLI_API_KEY') ?? ''
    ).trim();
    this.faceId = (
      this.configService.get<string>('SIMLI_FACE_ID') ?? ''
    ).trim();
    this.baseUrl = (
      this.configService.get<string>('SIMLI_BASE_URL') ?? 'https://api.simli.ai'
    )
      .trim()
      .replace(/\/$/, '');
  }

  async createSession(
    _personaId: string,
    _voiceId?: string,
  ): Promise<DigitalHumanSessionInfo> {
    this.ensureConfig();

    const url = `${this.baseUrl}/compose/token`;
    const body = {
      faceId: this.faceId,
      apiVersion: 'v2',
      handleSilence: true,
      maxIdleTime: 300,
      maxSessionLength: 3600,
      startFrame: 0,
      audioInputFormat: 'pcm16',
    };
    const startedAt = Date.now();

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const res = await this.fetchWithTimeout(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-simli-api-key': this.apiKey,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new ServiceUnavailableException(
            `Simli createSession HTTP ${res.status}: ${text}`,
          );
        }

        const payload = (await res
          .json()
          .catch(() => ({}))) as SimliCreateSessionResponse;
        const token =
          payload.session_token ??
          payload.sessionToken ??
          payload.data?.session_token ??
          payload.data?.sessionToken;
        const providerSessionId =
          payload.sessionId ??
          payload.id ??
          payload.data?.sessionId ??
          randomUUID();

        if (!token) {
          throw new ServiceUnavailableException(
            'Simli 响应中缺少 session_token/sessionToken',
          );
        }

        this.logger.log(
          `Simli 会话创建成功: session=${providerSessionId}, cost=${Date.now() - startedAt}ms`,
        );
        return {
          providerSessionId,
          speakMode: 'pcm-stream',
          credentials: {
            provider: this.name,
            sessionToken: token,
            wsUrl: this.buildWsUrl('/compose/webrtc/p2p'),
            faceId: this.faceId,
          },
        };
      } catch (error) {
        const isLast = attempt >= 2;
        const message = this.describeError(error);
        if (isLast) {
          this.logger.error(
            `Simli createSession 失败: url=${url}, faceId=${this.faceId}, attempt=${attempt}, error=${message}`,
          );
          throw new ServiceUnavailableException(
            `Simli createSession 失败: ${message}`,
          );
        }
        await this.delay(250 * attempt);
      }
    }

    throw new InternalServerErrorException('Simli createSession 未知错误');
  }

  async interrupt(providerSessionId: string): Promise<void> {
    // Simli 在 pcm-stream 模式通常由前端 stop() 触发，这里保留后端日志和扩展点。
    this.logger.log(`Simli interrupt: session=${providerSessionId}`);
  }

  async closeSession(providerSessionId: string): Promise<void> {
    // 部分账号/版本没有开放 close endpoint，当前以日志 + 幂等成功处理。
    this.logger.log(`Simli closeSession: session=${providerSessionId}`);
  }

  async healthCheck(): Promise<DigitalHumanHealthStatus> {
    if (!this.apiKey || !this.faceId) {
      return {
        status: 'error',
        message: 'SIMLI_API_KEY 或 SIMLI_FACE_ID 未配置',
      };
    }
    return { status: 'ok' };
  }

  private async fetchWithTimeout(
    input: string,
    init: RequestInit,
    timeoutMs = 5000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ServiceUnavailableException('Simli 请求超时');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private ensureConfig(): void {
    if (!this.apiKey || !this.faceId) {
      throw new ServiceUnavailableException(
        'Simli 配置缺失：请设置 SIMLI_API_KEY 与 SIMLI_FACE_ID',
      );
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildWsUrl(pathname: string): string {
    const wsBase = this.baseUrl
      .replace(/^https:\/\//i, 'wss://')
      .replace(/^http:\/\//i, 'ws://');
    return `${wsBase}${pathname}`;
  }

  private describeError(error: unknown): string {
    if (!(error instanceof Error)) {
      return String(error);
    }
    const cause = error.cause as
      | {
          code?: string;
          errno?: number;
          syscall?: string;
          hostname?: string;
          address?: string;
          port?: number;
        }
      | undefined;
    if (!cause) {
      return error.message;
    }

    const detail = [
      cause.code ? `code=${cause.code}` : '',
      cause.errno !== undefined ? `errno=${cause.errno}` : '',
      cause.syscall ? `syscall=${cause.syscall}` : '',
      cause.hostname ? `hostname=${cause.hostname}` : '',
      cause.address ? `address=${cause.address}` : '',
      cause.port !== undefined ? `port=${cause.port}` : '',
    ]
      .filter(Boolean)
      .join(', ');

    return detail ? `${error.message} (${detail})` : error.message;
  }
}
