import { Strategy } from 'passport-custom';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '@/auth/services/auth.service';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  constructor(private readonly authService: AuthService) {
    super();
  }

  async validate(req: any) {
    let key = this.normalizeHeader(req.headers['x-api-key']);

    if (!key) {
      const authHeader = this.normalizeHeader(req.headers['authorization']);
      const bearerMatch = authHeader ? /^Bearer\s+(.+)$/i.exec(authHeader) : null;
      if (bearerMatch?.[1]) {
        const token = bearerMatch[1].trim();
        if (token.startsWith('dh_')) {
          key = token;
        }
      }
    }

    if (!key) {
      throw new UnauthorizedException('未提供 API Key');
    }

    const user = await this.authService.validateApiKey(key);
    if (!user) {
      throw new UnauthorizedException('API Key 无效或已被废弃');
    }

    return {
      id: user.id,
      username: user.username,
      role: user.role,
    };
  }

  private normalizeHeader(value: unknown): string | undefined {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return undefined;
    const normalized = raw.trim();
    return normalized || undefined;
  }
}
