import { PartialType } from '@nestjs/swagger';
import { CreateKnowledgeDto } from '@/knowledge/dto/create-knowledge.dto';

export class UpdateKnowledgeDto extends PartialType(CreateKnowledgeDto) {}
