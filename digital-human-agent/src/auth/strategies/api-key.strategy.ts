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
    let key = req.headers['x-api-key'];

    if (!key) {
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
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
}
