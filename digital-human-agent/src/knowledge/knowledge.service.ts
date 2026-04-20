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
  threshold: 0.6,
  stage1TopK: 20,
  finalTopK: 5,
  rerank: true,
};

@Injectable()
export class KnowledgeBaseService {
  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly kbRepo: Repository<KnowledgeBase>,
    @InjectRepository(PersonaKnowledgeBase)
    private readonly mountRepo: Repository<PersonaKnowledgeBase>,
  ) {}

  listAll(): Promise<KnowledgeBase[]> {
    return this.kbRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<KnowledgeBase> {
    const kb = await this.kbRepo.findOneBy({ id });
    if (!kb) throw new NotFoundException(`知识库 ${id} 不存在`);
    return kb;
  }

  async create(dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const retrievalConfig: KnowledgeBaseRetrievalConfig = {
      ...DEFAULT_RETRIEVAL_CONFIG,
      ...(dto.retrievalConfig ?? {}),
    };

    return this.kbRepo.save(
      this.kbRepo.create({
        name: dto.name,
        description: dto.description ?? null,
        ownerPersonaId: dto.ownerPersonaId ?? null,
        retrievalConfig,
      }),
    );
  }

  async update(
    id: string,
    dto: UpdateKnowledgeBaseDto,
  ): Promise<KnowledgeBase> {
    const kb = await this.findOne(id);

    if (dto.name !== undefined) kb.name = dto.name;
    if (dto.description !== undefined) kb.description = dto.description ?? null;
    if (dto.ownerPersonaId !== undefined) {
      kb.ownerPersonaId = dto.ownerPersonaId ?? null;
    }
    if (dto.retrievalConfig !== undefined) {
      kb.retrievalConfig = {
        ...kb.retrievalConfig,
        ...dto.retrievalConfig,
      };
    }

    return this.kbRepo.save(kb);
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const result = await this.kbRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`知识库 ${id} 不存在`);
    }
    return { id, deleted: true };
  }

  async listKbsForPersona(personaId: string): Promise<KnowledgeBase[]> {
    return this.kbRepo
      .createQueryBuilder('kb')
      .innerJoin(
        'persona_knowledge_base',
        'pkb',
        'pkb.knowledge_base_id = kb.id',
      )
      .where('pkb.persona_id = :personaId', { personaId })
      .orderBy('kb.created_at', 'DESC')
      .getMany();
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
}
