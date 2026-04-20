import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { KnowledgeBase } from '../knowledge-base/knowledge-base.entity';

export type DocumentStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type DocumentSourceType = 'upload';

@Entity('knowledge_document')
export class KnowledgeDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId: string;

  @ManyToOne(() => KnowledgeBase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'knowledge_base_id' })
  knowledgeBase: KnowledgeBase;

  @Column()
  filename: string;

  @Column({ default: 'pending' })
  status: DocumentStatus;

  @Column({ name: 'chunk_count', default: 0 })
  chunkCount: number;

  @Column({ name: 'mime_type', type: 'text', nullable: true })
  mimeType: string | null;

  @Column({ name: 'file_size', type: 'int', nullable: true })
  fileSize: number | null;

  @Column({ name: 'source_type', type: 'text', default: 'upload' })
  sourceType: DocumentSourceType;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
