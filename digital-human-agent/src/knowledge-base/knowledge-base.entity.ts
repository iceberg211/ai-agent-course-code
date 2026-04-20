import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface KnowledgeBaseRetrievalConfig {
  /** v2 版本标识；无此字段或值为 1 时视为旧版本 */
  schemaVersion?: number;
  retrievalMode: 'vector' | 'keyword' | 'hybrid';
  threshold: number;
  /** @deprecated 迁移为 vectorTopK，v1 向下兼容保留 */
  stage1TopK?: number;
  vectorTopK: number;
  keywordTopK: number;
  /** 融合候选上限；默认 = vectorTopK + keywordTopK */
  candidateLimit?: number;
  finalTopK: number;
  rerank: boolean;
  fusion: {
    method: 'rrf';
    rrfK: number;
    vectorWeight: number;
    keywordWeight: number;
  };
  /** 置信度相关参数（BM25 归一化、最少支撑命中数） */
  confidence?: {
    /** BM25 分数饱和点，用于归一化到 0-1 区间；默认 12 */
    keywordBm25SaturationScore: number;
    /** 要求至少有几个候选支撑答案；默认 1 */
    minSupportingHits: number;
  };
}

@Entity('knowledge_base')
export class KnowledgeBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'owner_persona_id', type: 'uuid', nullable: true })
  ownerPersonaId: string | null;

  @Column({ name: 'retrieval_config', type: 'jsonb' })
  retrievalConfig: KnowledgeBaseRetrievalConfig;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
