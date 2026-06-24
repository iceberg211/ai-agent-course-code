import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { UserService } from '@/user/services/user.service';
import { ApiKey } from '@/auth/entities/api-key.entity';
import { User } from '@/user/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    @InjectRepository(ApiKey)
    private readonly apiKeyRepo: Repository<ApiKey>,
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

  async changePassword(userId: string, oldPasswordPlain: string, newPasswordPlain: string) {
    const user = await this.userService.findOne(userId);
    if (!user || !user.password) {
      throw new UnauthorizedException('用户不存在');
    }

    const matched = this.comparePassword(oldPasswordPlain, user.password);
    if (!matched) {
      throw new BadRequestException('旧密码错误');
    }

    return this.userService.updatePassword(userId, newPasswordPlain);
  }

  async createApiKey(userId: string, name: string): Promise<ApiKey> {
    const key = `dh_${randomBytes(24).toString('hex')}`;
    const apiKey = this.apiKeyRepo.create({
      userId,
      name,
      key,
    });
    return this.apiKeyRepo.save(apiKey);
  }

  async listApiKeys(userId: string): Promise<ApiKey[]> {
    return this.apiKeyRepo.find({
      where: { userId, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async revokeApiKey(userId: string, id: string): Promise<void> {
    await this.apiKeyRepo.update({ id, userId }, { isActive: false });
  }

  async validateApiKey(key: string): Promise<User | null> {
    const record = await this.apiKeyRepo.findOne({
      where: { key, isActive: true },
      relations: ['user'],
    });
    if (!record || !record.user) {
      return null;
    }
    return record.user;
  }

  private comparePassword(password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const verifyHash = scryptSync(password, salt, 64);
    return timingSafeEqual(Buffer.from(hash, 'hex'), verifyHash);
  }
}
