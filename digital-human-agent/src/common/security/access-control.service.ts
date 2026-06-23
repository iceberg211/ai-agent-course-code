import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { IncomingMessage } from 'node:http';

@Injectable()
export class AccessControlService {
  private readonly logger = new Logger(AccessControlService.name);

  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return this.requiredToken.length > 0;
  }

  /**
   * 使用 timingSafeEqual 进行常量时间比较，防止时序攻击（timing attack）。
   * 攻击者无法通过响应时间差异逐位推断 Token 内容。
   */
  validateToken(token: string | undefined): boolean {
    if (!this.isEnabled()) {
      return true;
    }
    if (!token) return false;

    const required = this.requiredToken;
    // 长度不同时直接返回 false，但仍进行一次 timingSafeEqual 防止长度信息泄露
    if (token.length !== required.length) {
      // 执行一次无意义比较以保持时间恒定
      timingSafeEqual(Buffer.from(required), Buffer.from(required));
      return false;
    }

    return timingSafeEqual(Buffer.from(token), Buffer.from(required));
  }

  assertHttpRequest(request: Request): void {
    if (!this.validateToken(this.extractHttpToken(request))) {
      throw new UnauthorizedException('访问令牌无效');
    }
  }

  validateWsRequest(request?: IncomingMessage): boolean {
    return this.validateToken(this.extractWsToken(request));
  }

  private get requiredToken(): string {
    return String(
      this.configService.get<string>('API_ACCESS_TOKEN') ?? '',
    ).trim();
  }

  /**
   * 仅从 Header 中提取 Token（x-api-key 或 Authorization: Bearer）。
   * 不再支持 URL Query String 传 Token，防止 Token 被写入服务器日志或浏览器历史。
   */
  private extractHttpToken(request: Request): string | undefined {
    return this.extractHeaderToken(
      request.headers['x-api-key'],
      request.headers.authorization,
    );
  }

  /**
   * WebSocket 握手阶段仅从 Header 中提取 Token。
   * 不再支持 ?api_key= / ?access_token= 查询参数，防止 Token 明文泄漏到日志。
   */
  private extractWsToken(request?: IncomingMessage): string | undefined {
    if (!request) return undefined;
    return this.extractHeaderToken(
      request.headers['x-api-key'],
      request.headers.authorization,
    );
  }

  private extractHeaderToken(
    apiKeyHeader: string | string[] | undefined,
    authorizationHeader: string | string[] | undefined,
  ): string | undefined {
    const apiKey = this.normalizeToken(apiKeyHeader);
    if (apiKey) return apiKey;

    const authorization = this.normalizeToken(authorizationHeader);
    if (!authorization) return undefined;
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization);
    return bearerMatch?.[1]?.trim() || authorization;
  }

  private normalizeToken(value: unknown): string | undefined {
    if (Array.isArray(value)) {
      return this.normalizeToken(value[0] as unknown);
    }
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      return undefined;
    }
    const normalized = String(value).trim();
    return normalized || undefined;
  }
}
