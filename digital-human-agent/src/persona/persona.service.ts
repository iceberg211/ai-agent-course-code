import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { Persona } from '@/persona/persona.entity';
import { CreatePersonaDto } from '@/persona/dto/create-persona.dto';
import { UpdatePersonaDto } from '@/persona/dto/update-persona.dto';

export interface DeletePersonaResult {
  id: string;
  deleted: boolean;
}

@Injectable()
export class PersonaService {
  private readonly logger = new Logger(PersonaService.name);

  constructor(
    @InjectRepository(Persona)
    private readonly repo: Repository<Persona>,
  ) {}

  create(dto: CreatePersonaDto): Promise<Persona> {
    const persona = this.repo.create({
      id: randomUUID(),
      ...dto,
    });
    return this.saveCreateIdempotently(persona);
  }

  findAll(): Promise<Persona[]> {
    return this.withTransientRetry('findAll', () =>
      this.repo.find({ order: { createdAt: 'DESC' } }),
    );
  }

  async findOne(id: string): Promise<Persona> {
    const persona = await this.withTransientRetry('findOne', () =>
      this.repo.findOneBy({ id }),
    );
    if (!persona) throw new NotFoundException(`Persona ${id} not found`);
    return persona;
  }

  async update(id: string, dto: UpdatePersonaDto): Promise<Persona> {
    await this.findOne(id);
    await this.withTransientRetry('update', () => this.repo.update(id, dto));
    return this.findOne(id);
  }

  async remove(id: string): Promise<DeletePersonaResult> {
    await this.findOne(id);
    const result = await this.withTransientRetry('remove', () =>
      this.repo.delete(id),
    );
    return { id, deleted: (result.affected ?? 0) > 0 };
  }

  private isTransientDbError(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message : String(error ?? '');
    return /Connection terminated unexpectedly|ECONNRESET|ETIMEDOUT|too many clients/i.test(
      message,
    );
  }

  private async withTransientRetry<T>(
    op: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (!this.isTransientDbError(error)) throw error;
      this.logger.warn(
        `${op} 首次失败，检测到数据库瞬时错误，准备重试一次：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      return fn();
    }
  }

  /**
   * create 场景下使用固定主键重试，避免“首写成功但连接断开”导致重复创建。
   */
  private async saveCreateIdempotently(persona: Persona): Promise<Persona> {
    try {
      return await this.repo.save(persona);
    } catch (error) {
      if (!this.isTransientDbError(error)) throw error;

      this.logger.warn(
        `create 首次失败，检测到数据库瞬时错误，准备按幂等策略重试：${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      // 如果首写其实已经成功，这里可直接读回
      const existing = await this.repo.findOneBy({ id: persona.id });
      if (existing) return existing;

      try {
        return await this.repo.save(persona);
      } catch (retryError) {
        const duplicateKeyCode = (retryError as { code?: string })?.code;
        if (duplicateKeyCode === '23505') {
          const duplicated = await this.repo.findOneBy({ id: persona.id });
          if (duplicated) return duplicated;
        }
        throw retryError;
      }
    }
  }
}
