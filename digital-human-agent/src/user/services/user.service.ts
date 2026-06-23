import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { scryptSync, randomBytes } from 'node:crypto';
import { User } from '@/user/entities/user.entity';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  async findOneByUsername(username: string): Promise<User | null> {
    return this.repo.findOneBy({ username });
  }

  async findOne(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  async create(username: string, passwordPlain: string): Promise<User> {
    const existing = await this.findOneByUsername(username);
    if (existing) {
      throw new ConflictException('用户名已存在');
    }

    const hashedPassword = this.hashPassword(passwordPlain);
    const user = this.repo.create({
      username,
      password: hashedPassword,
    });

    const saved = await this.repo.save(user);
    // 不将密码散列值泄露回上层
    delete saved.password;
    return saved;
  }

  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }
}
