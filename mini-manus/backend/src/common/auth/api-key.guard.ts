import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqual } from 'crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseApiKeys(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function readHeaderApiKey(request: Request): string | null {
  const header = request.headers['x-api-key'];
  if (Array.isArray(header)) return header[0] ?? null;
  return typeof header === 'string' && header.trim() ? header.trim() : null;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly apiKeys: string[];

  constructor(config: ConfigService) {
    this.apiKeys = parseApiKeys(config.get<string>('APP_API_KEYS', ''));
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (this.apiKeys.length === 0) return true;

    const apiKey = readHeaderApiKey(request);
    if (apiKey && this.apiKeys.some((allowed) => secureEquals(apiKey, allowed))) {
      return true;
    }

    throw new UnauthorizedException('API Key 无效或缺失');
  }
}
