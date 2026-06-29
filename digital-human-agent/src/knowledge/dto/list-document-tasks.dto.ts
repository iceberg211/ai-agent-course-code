import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import type {
  DocumentTaskStatus,
  DocumentTaskType,
} from '@/knowledge/entities/document-task.entity';

export class ListDocumentTasksDto {
  @ApiPropertyOptional({ description: '知识库 ID' })
  @IsOptional()
  @IsUUID()
  knowledgeBaseId?: string;

  @ApiPropertyOptional({ description: '文档 ID' })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({ description: '任务类型' })
  @IsOptional()
  @IsIn(['parse', 'index', 'graph_sync', 'upload_ingest'])
  taskType?: DocumentTaskType;

  @ApiPropertyOptional({ description: '任务状态' })
  @IsOptional()
  @IsIn(['pending', 'running', 'completed', 'failed', 'cancelled'])
  status?: DocumentTaskStatus;

  @ApiPropertyOptional({ description: '处理阶段' })
  @IsOptional()
  @IsString()
  stage?: string;

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
}
