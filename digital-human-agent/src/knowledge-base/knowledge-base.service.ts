import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  KnowledgeBase,
  KnowledgeBaseRetrievalConfig,
} from './knowledge-base.entity';
import { PersonaKnowledgeBase } from './persona-knowledge-base.entity';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';

const DEFAULT_RETRIEVAL_CONFIG: KnowledgeBaseRetrievalConfig = {
  retrievalMode: 'vector',
  threshold: 0.6,
  stage1TopK: 20,
  vectorTopK: 20,
  keywordTopK: 20,
  finalTopK: 5,
  rerank: true,
  fusion: {
    method: 'rrf',
    rrfK: 60,
    vectorWeight: 1,
    keywordWeight: 1,
  },
};

type RetrievalConfigInput = Omit<
  Partial<KnowledgeBaseRetrievalConfig>,
  'fusion'
> & {
  fusion?: Partial<KnowledgeBaseRetrievalConfig['fusion']>;
};

@Injectable()
export class KnowledgeBaseService {
  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly kbRepo: Repository<KnowledgeBase>,
    @InjectRepository(PersonaKnowledgeBase)
    private readonly mountRepo: Repository<PersonaKnowledgeBase>,
  ) {}

  async listAll(): Promise<KnowledgeBase[]> {
    const rows = await this.kbRepo.find({ order: { createdAt: 'DESC' } });
    return rows.map((kb) => this.withNormalizedRetrievalConfig(kb));
  }

  async findOne(id: string): Promise<KnowledgeBase> {
    return this.withNormalizedRetrievalConfig(await this.findEntity(id));
  }

  private async findEntity(id: string): Promise<KnowledgeBase> {
    const kb = await this.kbRepo.findOneBy({ id });
    if (!kb) throw new NotFoundException(`知识库 ${id} 不存在`);
    return kb;
  }

  async create(dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const retrievalConfig = this.normalizeRetrievalConfig(dto.retrievalConfig);

    const saved = await this.kbRepo.save(
      this.kbRepo.create({
        name: dto.name,
        description: dto.description ?? null,
        ownerPersonaId: dto.ownerPersonaId ?? null,
        retrievalConfig,
      }),
    );
    return this.withNormalizedRetrievalConfig(saved);
  }

  async update(
    id: string,
    dto: UpdateKnowledgeBaseDto,
  ): Promise<KnowledgeBase> {
    const kb = await this.findEntity(id);

    if (dto.name !== undefined) kb.name = dto.name;
    if (dto.description !== undefined) kb.description = dto.description ?? null;
    if (dto.ownerPersonaId !== undefined) {
      kb.ownerPersonaId = dto.ownerPersonaId ?? null;
    }
    if (dto.retrievalConfig !== undefined) {
      kb.retrievalConfig = this.normalizeRetrievalConfig(
        dto.retrievalConfig,
        kb.retrievalConfig,
      );
    }

    const saved = await this.kbRepo.save(kb);
    return this.withNormalizedRetrievalConfig(saved);
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const result = await this.kbRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`知识库 ${id} 不存在`);
    }
    return { id, deleted: true };
  }

  async listKbsForPersona(personaId: string): Promise<KnowledgeBase[]> {
    const rows = await this.kbRepo
      .createQueryBuilder('kb')
      .innerJoin(
        'persona_knowledge_base',
        'pkb',
        'pkb.knowledge_base_id = kb.id',
      )
      .where('pkb.persona_id = :personaId', { personaId })
      .orderBy('kb.created_at', 'DESC')
      .getMany();
    return rows.map((kb) => this.withNormalizedRetrievalConfig(kb));
  }

  async listPersonaIdsForKb(kbId: string): Promise<string[]> {
    const rows = await this.mountRepo.find({
      where: { knowledgeBaseId: kbId },
      select: ['personaId'],
    });
    return rows.map((r) => r.personaId);
  }

  async attachPersona(personaId: string, kbId: string): Promise<void> {
    await this.findOne(kbId); // 404 if missing
    const existing = await this.mountRepo.findOneBy({
      personaId,
      knowledgeBaseId: kbId,
    });
    if (existing) {
      throw new BadRequestException('该知识库已挂载到此 persona');
    }
    await this.mountRepo.save(
      this.mountRepo.create({ personaId, knowledgeBaseId: kbId }),
    );
  }

  async detachPersona(personaId: string, kbId: string): Promise<void> {
    const result = await this.mountRepo.delete({
      personaId,
      knowledgeBaseId: kbId,
    });
    if (result.affected === 0) {
      throw new NotFoundException('挂载关系不存在');
    }
  }

  private normalizeRetrievalConfig(
    input?: RetrievalConfigInput,
    base: RetrievalConfigInput = {},
  ): KnowledgeBaseRetrievalConfig {
    const merged = {
      ...DEFAULT_RETRIEVAL_CONFIG,
      ...base,
      ...input,
      fusion: {
        ...DEFAULT_RETRIEVAL_CONFIG.fusion,
        ...(base.fusion ?? {}),
        ...(input?.fusion ?? {}),
      },
    };
    const vectorTopK = this.toInt(
      input?.vectorTopK ?? input?.stage1TopK ?? merged.vectorTopK,
      DEFAULT_RETRIEVAL_CONFIG.vectorTopK,
      1,
      50,
    );

    return {
      retrievalMode: this.normalizeRetrievalMode(merged.retrievalMode),
      threshold: this.toNumber(
        merged.threshold,
        DEFAULT_RETRIEVAL_CONFIG.threshold,
        0,
        1,
      ),
      stage1TopK: vectorTopK,
      vectorTopK,
      keywordTopK: this.toInt(
        merged.keywordTopK,
        DEFAULT_RETRIEVAL_CONFIG.keywordTopK,
        1,
        50,
      ),
      finalTopK: this.toInt(
        merged.finalTopK,
        DEFAULT_RETRIEVAL_CONFIG.finalTopK,
        1,
        20,
      ),
      rerank: merged.rerank !== false,
      fusion: {
        method: 'rrf',
        rrfK: this.toInt(
          merged.fusion.rrfK,
          DEFAULT_RETRIEVAL_CONFIG.fusion.rrfK,
          1,
          200,
        ),
        vectorWeight: this.toNumber(
          merged.fusion.vectorWeight,
          DEFAULT_RETRIEVAL_CONFIG.fusion.vectorWeight,
          0,
          10,
        ),
        keywordWeight: this.toNumber(
          merged.fusion.keywordWeight,
          DEFAULT_RETRIEVAL_CONFIG.fusion.keywordWeight,
          0,
          10,
        ),
      },
    };
  }

  private withNormalizedRetrievalConfig(kb: KnowledgeBase): KnowledgeBase {
    return {
      ...kb,
      retrievalConfig: this.normalizeRetrievalConfig(kb.retrievalConfig),
    };
  }

  private normalizeRetrievalMode(
    value: KnowledgeBaseRetrievalConfig['retrievalMode'] | undefined,
  ): KnowledgeBaseRetrievalConfig['retrievalMode'] {
    if (value === 'keyword' || value === 'hybrid') return value;
    return 'vector';
  }

  private toInt(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(Math.max(Math.round(num), min), max);
  }

  private toNumber(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(Math.max(num, min), max);
  }
}
