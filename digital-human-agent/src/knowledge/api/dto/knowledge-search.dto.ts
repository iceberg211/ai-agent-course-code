import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class KnowledgeSearchFusionDto {
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

export class KnowledgeSearchHistoryMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  content: string;
}

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
    description: '检索模式：向量、关键词或混合检索',
    enum: ['vector', 'keyword', 'hybrid'],
    default: 'vector',
  })
  @IsOptional()
  @IsIn(['vector', 'keyword', 'hybrid'])
  retrievalMode?: 'vector' | 'keyword' | 'hybrid';

  @ApiPropertyOptional({
    description: '是否启用第二阶段 Rerank',
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  rerank?: boolean;

  @ApiPropertyOptional({
    description: '第一阶段向量召回条数',
    default: 20,
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
    description: '向量召回条数；未传时兼容 stage1TopK',
    default: 20,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  vectorTopK?: number;

  @ApiPropertyOptional({
    description: '关键词召回条数',
    default: 20,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  keywordTopK?: number;

  @ApiPropertyOptional({
    description: '融合候选上限；hybrid 模式下用于截断融合后的候选集',
    default: 40,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  candidateLimit?: number;

  @ApiPropertyOptional({
    description: '最终返回条数',
    default: 5,
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  finalTopK?: number;

  @ApiPropertyOptional({
    description: '向量匹配阈值',
    default: 0.6,
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
    description: '融合配置；hybrid 模式下使用 RRF 融合候选集',
    type: KnowledgeSearchFusionDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => KnowledgeSearchFusionDto)
  fusion?: KnowledgeSearchFusionDto;

  @ApiPropertyOptional({
    description: '是否启用检索前 Query Rewrite',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  rewrite?: boolean;

  @ApiPropertyOptional({
    description: '用于 Query Rewrite 的最近对话',
    type: [KnowledgeSearchHistoryMessageDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KnowledgeSearchHistoryMessageDto)
  history?: KnowledgeSearchHistoryMessageDto[];
}
