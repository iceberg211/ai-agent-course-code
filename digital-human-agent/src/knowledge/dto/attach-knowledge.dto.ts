import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class AttachKnowledgeDto {
  @ApiProperty({ description: '要挂载到当前 persona 的知识库 ID' })
  @IsUUID() @IsNotEmpty()
  knowledgeId: string;
}
