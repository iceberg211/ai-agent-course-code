import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG } from '@/common/constants';

export class RetrievalConfigDto {
  @ApiPropertyOptional({
    default: DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.threshold,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  threshold?: number;

  @ApiPropertyOptional({
    default: DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.stage1TopK,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  stage1TopK?: number;

  @ApiPropertyOptional({
    default: DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.finalTopK,
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  finalTopK?: number;

  @ApiPropertyOptional({ default: DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.rerank })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  rerank?: boolean;
}

export class CreateKnowledgeDto {
  @ApiProperty({ description: '知识库名称', example: '产品 FAQ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ description: '知识库描述' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: '所属 persona（可空，为空即为公共知识库）',
  })
  @IsOptional()
  @IsUUID()
  ownerPersonaId?: string;

  @ApiPropertyOptional({ type: RetrievalConfigDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RetrievalConfigDto)
  retrievalConfig?: RetrievalConfigDto;
}
