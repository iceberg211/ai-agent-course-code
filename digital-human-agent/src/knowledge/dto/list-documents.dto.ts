import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  IsIn,
} from 'class-validator';

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

  @ApiPropertyOptional({ description: '标签，多个以逗号分隔' })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiPropertyOptional({ description: '所属部门' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: '业务分类' })
  @IsOptional()
  @IsString()
  businessCategory?: string;

  @ApiPropertyOptional({ description: '权限范围' })
  @IsOptional()
  @IsIn(['private', 'department', 'company'])
  visibility?: 'private' | 'department' | 'company';

  @ApiPropertyOptional({ description: '过期时间早于该时间的文档' })
  @IsOptional()
  @IsString()
  expiresBefore?: string;
}

export class BatchRetryDocumentsDto {
  @IsArray({ message: 'documentIds 必须是数组' })
  @ArrayMinSize(1, { message: 'documentIds 至少包含一个文档 ID' })
  @IsUUID('4', { each: true, message: 'documentIds 中存在非法文档 ID' })
  documentIds: string[];
}
