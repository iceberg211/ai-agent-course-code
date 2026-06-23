import { PartialType } from '@nestjs/swagger';
import { CreateEvalCaseDto } from '@/knowledge/dto/create-eval-case.dto';

export class UpdateEvalCaseDto extends PartialType(CreateEvalCaseDto) {}
