import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { UserService } from '@/user/services/user.service';
import { ApiKey } from '@/auth/entities/api-key.entity';
import { User } from '@/user/entities/user.entity';
import { NotificationService } from '@/notification/notification.service';

export interface ApiKeyListItem {
  id: string;
  name: string;
  keyPrefix: string;
  keyLastFour: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatedApiKeyResponse extends ApiKeyListItem {
  key: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    @InjectRepository(ApiKey)
    private readonly apiKeyRepo: Repository<ApiKey>,
    @Optional()
    private readonly notificationService?: NotificationService,
  ) {}

  async register(username: string, passwordPlain: string, department?: string) {
    return this.userService.create(username, passwordPlain, department);
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
        role: user.role,
        department: user.department,
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

  async getProfile(userId: string) {
    const user = await this.userService.findOne(userId);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    delete user.password;
    return user;
  }

  async updateProfile(userId: string, input: { department?: string | null }) {
    return this.userService.updateProfile(userId, input);
  }

  async createApiKey(userId: string, name: string): Promise<CreatedApiKeyResponse> {
    const key = `dh_${randomBytes(24).toString('hex')}`;
    const keyHash = this.hashSecret(key);
    const apiKey = this.apiKeyRepo.create({
      userId,
      name,
      keyHash,
      keyPrefix: key.slice(0, 11),
      keyLastFour: key.slice(-4),
    });
    const saved = await this.apiKeyRepo.save(apiKey);
    void this.notificationService?.create({
      ownerId: userId,
      type: 'api_key_created',
      title: 'API Key 已创建',
      message: `访问凭证 ${name} 已创建`,
      payload: { apiKeyId: saved.id, name },
    });
    return {
      ...this.toApiKeyListItem(saved),
      key,
    };
  }

  async listApiKeys(userId: string): Promise<ApiKeyListItem[]> {
    const records = await this.apiKeyRepo.find({
      where: { userId, isActive: true },
      order: { createdAt: 'DESC' },
    });
    return records.map((item) => this.toApiKeyListItem(item));
  }

  async revokeApiKey(userId: string, id: string): Promise<void> {
    const result = await this.apiKeyRepo.update({ id, userId }, { isActive: false });
    if (!result.affected) {
      throw new NotFoundException('API Key 不存在或不属于当前用户');
    }
    void this.notificationService?.create({
      ownerId: userId,
      type: 'api_key_revoked',
      title: 'API Key 已废弃',
      message: '一个访问凭证已被废弃',
      payload: { apiKeyId: id },
    });
  }

  async validateApiKey(key: string): Promise<User | null> {
    if (!key.startsWith('dh_') || key.length < 16) {
      return null;
    }

    const records = await this.apiKeyRepo.find({
      where: { keyPrefix: key.slice(0, 11), isActive: true },
      relations: ['user'],
    });

    for (const record of records) {
      if (record.user && this.compareSecret(key, record.keyHash)) {
        return record.user;
      }
    }
    return null;
  }

  private comparePassword(password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const verifyHash = scryptSync(password, salt, 64);
    return timingSafeEqual(Buffer.from(hash, 'hex'), verifyHash);
  }

  private hashSecret(secret: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(secret, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  private compareSecret(secret: string, stored: string): boolean {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    if (!/^[a-f0-9]+$/i.test(hash)) return false;

    const expected = Buffer.from(hash, 'hex');
    if (expected.length === 0) return false;
    const actual = scryptSync(secret, salt, expected.length);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  private toApiKeyListItem(apiKey: ApiKey): ApiKeyListItem {
    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      keyLastFour: apiKey.keyLastFour,
      isActive: apiKey.isActive,
      createdAt: apiKey.createdAt,
      updatedAt: apiKey.updatedAt,
    };
  }
}
