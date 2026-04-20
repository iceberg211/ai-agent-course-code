import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { KnowledgeDocument } from '@/knowledge-content/entities/knowledge-document.entity';

@Entity('knowledge_chunk')
export class KnowledgeChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @ManyToOne(() => KnowledgeDocument, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: KnowledgeDocument;

  @Column({ name: 'chunk_index' })
  chunkIndex: number;

  @Column({ type: 'text' })
  content: string;

  // char_count 是 PG GENERATED ALWAYS 列，TypeORM 必须显式标记只读
  // 否则 INSERT/UPDATE 时会传入值，PG 会返回：
  //   "column \"char_count\" can only be updated to DEFAULT"
  @Column({ name: 'char_count', insert: false, update: false })
  charCount: number;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'text' })
  source: string;

  @Column({ type: 'text', nullable: true })
  category: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // 注：embedding 列是 VECTOR(1024)，TypeORM entity 故意不映射该字段。
  // 写入 embedding 走 Supabase client（ingest 时批量 insert），
  // 读取走 match_knowledge RPC。entity 只用于 chunk 列表查询、
  // 启用/禁用开关等非向量操作。
}
