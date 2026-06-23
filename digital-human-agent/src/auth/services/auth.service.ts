import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { UserService } from '@/user/services/user.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async register(username: string, passwordPlain: string) {
    return this.userService.create(username, passwordPlain);
  }

  async login(username: string, passwordPlain: string) {
    const user = await this.userService.findOneByUsername(username);
    if (!user || !user.password) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const matched = this.comparePassword(passwordPlain, user.password);
    if (!matched) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const payload = { sub: user.id, username: user.username };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        username: user.username,
      },
    };
  }

  private comparePassword(password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const verifyHash = scryptSync(password, salt, 64);
    return timingSafeEqual(Buffer.from(hash, 'hex'), verifyHash);
  }
}
