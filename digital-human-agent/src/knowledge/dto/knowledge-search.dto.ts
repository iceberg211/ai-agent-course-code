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
  Min,
} from 'class-validator';

export class KnowledgeSearchDto {
  @ApiProperty({
    description: '检索问题',
    example: 'React Compiler 是什么？',
  })
  @IsString()
  @IsNotEmpty()
  query: string;

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
}
