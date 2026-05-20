import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Knowledge } from '@/knowledge/entities/knowledge.entity';

export type DocumentStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type DocumentSourceType = 'upload';
export type DocumentGraphSyncStatus =
  | 'pending'
  | 'indexed'
  | 'failed'
  | 'skipped';

@Entity('knowledge_document')
export class KnowledgeDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId: string;

  @ManyToOne(() => Knowledge, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'knowledge_base_id' })
  knowledge: Knowledge;

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

  @Column({ name: 'graph_sync_status', type: 'text', default: 'pending' })
  graphSyncStatus: DocumentGraphSyncStatus;

  @Column({ name: 'graph_sync_error', type: 'text', nullable: true })
  graphSyncError: string | null;

  @Column({ name: 'graph_synced_at', type: 'timestamptz', nullable: true })
  graphSyncedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
