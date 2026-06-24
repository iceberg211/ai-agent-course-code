import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ListDocumentsDto {
  @ApiPropertyOptional({ description: '按文件名搜索' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: '知识库 ID' })
  @IsOptional()
  @IsUUID()
  knowledgeBaseId?: string;

  @ApiPropertyOptional({ description: '文件类型或 MIME 关键字' })
  @IsOptional()
  @IsString()
  fileType?: string;

  @ApiPropertyOptional({ description: '文档处理状态' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: '图谱同步状态' })
  @IsOptional()
  @IsString()
  graphStatus?: string;

  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页数量', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ description: '文档解析/处理子阶段' })
  @IsOptional()
  @IsString()
  processingStage?: string;
}
