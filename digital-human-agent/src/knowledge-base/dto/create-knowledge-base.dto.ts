import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
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

export class FusionConfigDto {
  @ApiPropertyOptional({ enum: ['rrf'], default: 'rrf' })
  @IsOptional()
  @IsIn(['rrf'])
  method?: 'rrf';

  @ApiPropertyOptional({ default: 60, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  rrfK?: number;

  @ApiPropertyOptional({ default: 1, minimum: 0, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10)
  vectorWeight?: number;

  @ApiPropertyOptional({ default: 1, minimum: 0, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10)
  keywordWeight?: number;
}

export class RetrievalConfigDto {
  @ApiPropertyOptional({ default: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(2)
  schemaVersion?: number;

  @ApiPropertyOptional({
    enum: ['vector', 'keyword', 'hybrid'],
    default: 'vector',
  })
  @IsOptional()
  @IsIn(['vector', 'keyword', 'hybrid'])
  retrievalMode?: 'vector' | 'keyword' | 'hybrid';

  @ApiPropertyOptional({ default: 0.6, minimum: 0, maximum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  threshold?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  stage1TopK?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  vectorTopK?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  keywordTopK?: number;

  @ApiPropertyOptional({ default: 40, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  candidateLimit?: number;

  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  finalTopK?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  rerank?: boolean;

  @ApiPropertyOptional({ type: FusionConfigDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FusionConfigDto)
  fusion?: FusionConfigDto;

  @ApiPropertyOptional({
    default: {
      keywordBm25SaturationScore: 12,
      minSupportingHits: 1,
    },
  })
  @IsOptional()
  @IsObject()
  confidence?: {
    keywordBm25SaturationScore?: number;
    minSupportingHits?: number;
  };
}

export class CreateKnowledgeBaseDto {
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
