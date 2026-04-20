import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Knowledge,
  KnowledgeRetrievalConfig,
} from '@/knowledge/knowledge.entity';
import { PersonaKnowledge } from '@/knowledge/persona-knowledge.entity';
import { CreateKnowledgeDto } from '@/knowledge/dto/create-knowledge.dto';
import { UpdateKnowledgeDto } from '@/knowledge/dto/update-knowledge.dto';

const DEFAULT_RETRIEVAL_CONFIG: KnowledgeRetrievalConfig = {
  threshold: 0.6,
  stage1TopK: 20,
  finalTopK: 5,
  rerank: true,
};

@Injectable()
export class KnowledgeService {
  constructor(
    @InjectRepository(Knowledge)
    private readonly knowledgeRepo: Repository<Knowledge>,
    @InjectRepository(PersonaKnowledge)
    private readonly personaKnowledgeRepo: Repository<PersonaKnowledge>,
  ) {}

  listAll(): Promise<Knowledge[]> {
    return this.knowledgeRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Knowledge> {
    const knowledge = await this.knowledgeRepo.findOneBy({ id });
    if (!knowledge) {
      throw new NotFoundException(`知识库 ${id} 不存在`);
    }
    return knowledge;
  }

  async create(dto: CreateKnowledgeDto): Promise<Knowledge> {
    const retrievalConfig: KnowledgeRetrievalConfig = {
      ...DEFAULT_RETRIEVAL_CONFIG,
      ...(dto.retrievalConfig ?? {}),
    };

    return this.knowledgeRepo.save(
      this.knowledgeRepo.create({
        name: dto.name,
        description: dto.description ?? null,
        ownerPersonaId: dto.ownerPersonaId ?? null,
        retrievalConfig,
      }),
    );
  }

  async update(id: string, dto: UpdateKnowledgeDto): Promise<Knowledge> {
    const knowledge = await this.findOne(id);

    if (dto.name !== undefined) knowledge.name = dto.name;
    if (dto.description !== undefined) {
      knowledge.description = dto.description ?? null;
    }
    if (dto.ownerPersonaId !== undefined) {
      knowledge.ownerPersonaId = dto.ownerPersonaId ?? null;
    }
    if (dto.retrievalConfig !== undefined) {
      knowledge.retrievalConfig = {
        ...knowledge.retrievalConfig,
        ...dto.retrievalConfig,
      };
    }

    return this.knowledgeRepo.save(knowledge);
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const result = await this.knowledgeRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`知识库 ${id} 不存在`);
    }
    return { id, deleted: true };
  }

  async listForPersona(personaId: string): Promise<Knowledge[]> {
    return this.knowledgeRepo
      .createQueryBuilder('knowledge')
      .innerJoin(
        'persona_knowledge_base',
        'personaKnowledge',
        'personaKnowledge.knowledge_base_id = knowledge.id',
      )
      .where('personaKnowledge.persona_id = :personaId', { personaId })
      .orderBy('knowledge.created_at', 'DESC')
      .getMany();
  }

  async listPersonaIdsForKnowledge(knowledgeId: string): Promise<string[]> {
    const rows = await this.personaKnowledgeRepo.find({
      where: { knowledgeBaseId: knowledgeId },
      select: ['personaId'],
    });
    return rows.map((row) => row.personaId);
  }

  async attachPersona(personaId: string, knowledgeId: string): Promise<void> {
    await this.findOne(knowledgeId);
    const existing = await this.personaKnowledgeRepo.findOneBy({
      personaId,
      knowledgeBaseId: knowledgeId,
    });

    if (existing) {
      throw new BadRequestException('该知识库已挂载到此 persona');
    }

    await this.personaKnowledgeRepo.save(
      this.personaKnowledgeRepo.create({
        personaId,
        knowledgeBaseId: knowledgeId,
      }),
    );
  }

  async detachPersona(personaId: string, knowledgeId: string): Promise<void> {
    const result = await this.personaKnowledgeRepo.delete({
      personaId,
      knowledgeBaseId: knowledgeId,
    });

    if (result.affected === 0) {
      throw new NotFoundException('挂载关系不存在');
    }
  }
}
