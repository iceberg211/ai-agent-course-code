import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Persona } from './persona.entity';
import { CreatePersonaDto } from './dto/create-persona.dto';
import { UpdatePersonaDto } from './dto/update-persona.dto';

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
    const persona = this.repo.create(dto);
    return this.withTransientRetry('create', () => this.repo.save(persona));
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
}
