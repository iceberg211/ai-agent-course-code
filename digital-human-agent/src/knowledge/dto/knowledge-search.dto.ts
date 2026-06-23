import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG } from '@/common/constants';

export class KnowledgeSearchDto {
  @ApiProperty({
    description: '检索问题',
    example: 'React Compiler 是什么？',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  query: string;

  @ApiPropertyOptional({
    description: '是否启用 Rerank 重排',
    default: DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.rerank,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  rerank?: boolean;

  @ApiPropertyOptional({
    description: '混合检索召回条数限制',
    default: DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.retrievalLimit,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  retrievalLimit?: number;

  @ApiPropertyOptional({
    description: '重排后最终返回条数限制',
    default: DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.rerankLimit,
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  rerankLimit?: number;

  @ApiPropertyOptional({
    description: '混合检索召回条数限制（已废弃，请使用 retrievalLimit）',
    deprecated: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  stage1TopK?: number;

  @ApiPropertyOptional({
    description: '重排后最终返回条数限制（已废弃，请使用 rerankLimit）',
    deprecated: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  finalTopK?: number;

  @ApiPropertyOptional({
    description: '向量匹配阈值',
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
}
