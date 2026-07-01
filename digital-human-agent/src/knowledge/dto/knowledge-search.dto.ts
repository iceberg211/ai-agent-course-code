import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsArray,
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
} from 'class-validator';
import { DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG } from '@/common/constants';
import type {
  DocumentSearchFilters,
  RetrieveKnowledgeOptions,
} from '@/knowledge/types/knowledge-content.types';
import type { RetrievalStrategy } from '@/common/rag';

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

  @ApiPropertyOptional({
    description: '检索策略覆盖项，可传入 precise、balanced、broad、graph_first、memory_aware、multimodal 等预设名称及局部字段',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  strategy?: Partial<RetrievalStrategy>;

  @ApiPropertyOptional({
    description: '是否启用图谱检索通道。未传时沿用策略默认值',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  useGraph?: boolean;

  @ApiPropertyOptional({
    description: '跨知识库搜索范围。不传时搜索全部知识库',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  knowledgeBaseIds?: string[];

  @ApiPropertyOptional({
    description: '按文件类型过滤，如 pdf、docx、image、audio、video',
  })
  @IsOptional()
  @IsString()
  fileType?: string;

  @ApiPropertyOptional({
    description: '按文档标签过滤，支持数组或逗号分隔字符串',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => normalizeTags(value))
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '按部门过滤' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: '按业务分类过滤' })
  @IsOptional()
  @IsString()
  businessCategory?: string;

  @ApiPropertyOptional({
    description: '按可见范围过滤',
    enum: ['private', 'department', 'company'],
  })
  @IsOptional()
  @IsIn(['private', 'department', 'company'])
  visibility?: 'private' | 'department' | 'company';

  /**
   * 将 DTO 转换为检索选项，统一处理旧字段兼容。
   *
   * `stage1TopK → retrievalLimit`、`finalTopK → rerankLimit` 的映射
   * 在此一次性完成，下游代码不再需要处理旧字段。
   */
  toRetrieveOptions(): RetrieveKnowledgeOptions {
    const strategy = {
      ...(this.strategy ?? {}),
      ...(this.useGraph === undefined ? {} : { useGraph: this.useGraph }),
    };
    return {
      rerank: this.rerank,
      threshold: this.threshold,
      retrievalLimit: this.retrievalLimit ?? this.stage1TopK,
      rerankLimit: this.rerankLimit ?? this.finalTopK,
      strategy,
      documentFilters: this.toDocumentFilters(),
    };
  }

  private toDocumentFilters(): DocumentSearchFilters | undefined {
    const filters: DocumentSearchFilters = {
      fileType: this.fileType?.trim() || undefined,
      tags: normalizeTags(this.tags),
      department: this.department?.trim() || undefined,
      businessCategory: this.businessCategory?.trim() || undefined,
      visibility: this.visibility,
    };
    return Object.values(filters).some((value) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value),
    )
      ? filters
      : undefined;
  }
}

function normalizeTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const list = value.map((item) => String(item).trim()).filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
  if (typeof value === 'string') {
    const list = value.split(',').map((item) => item.trim()).filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
  return undefined;
}
