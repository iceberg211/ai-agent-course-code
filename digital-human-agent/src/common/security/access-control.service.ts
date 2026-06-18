import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { IncomingMessage } from 'node:http';

@Injectable()
export class AccessControlService {
  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return this.requiredToken.length > 0;
  }

  validateToken(token: string | undefined): boolean {
    if (!this.isEnabled()) {
      return true;
    }
    return token === this.requiredToken;
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

  private extractHttpToken(request: Request): string | undefined {
    const headerToken = this.extractHeaderToken(
      request.headers['x-api-key'],
      request.headers.authorization,
    );
    if (headerToken) return headerToken;

    const queryToken = request.query?.api_key ?? request.query?.access_token;
    return this.normalizeToken(queryToken);
  }

  private extractWsToken(request?: IncomingMessage): string | undefined {
    if (!request) return undefined;
    const headerToken = this.extractHeaderToken(
      request.headers['x-api-key'],
      request.headers.authorization,
    );
    if (headerToken) return headerToken;

    const rawUrl = String(request.url ?? '');
    const query = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : '';
    const params = new URLSearchParams(query);
    return (
      this.normalizeToken(params.get('api_key')) ??
      this.normalizeToken(params.get('access_token'))
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
