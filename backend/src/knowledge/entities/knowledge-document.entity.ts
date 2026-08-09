import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Knowledge } from '@/knowledge/entities/knowledge.entity';

export type DocumentStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type DocumentSourceType = 'upload';
export type DocumentProcessingStage =
  | 'uploaded'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'keyword_indexing'
  | 'graph_indexing'
  | 'completed'
  | 'failed';
export type DocumentGraphSyncStatus =
  | 'pending'
  | 'indexed'
  | 'failed'
  | 'skipped';
export type DocumentVisibility = 'private' | 'department' | 'company';

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

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string | null;

  @Column({ name: 'processing_stage', type: 'text', default: 'completed' })
  processingStage: DocumentProcessingStage;

  @Column({ name: 'processing_error', type: 'text', nullable: true })
  processingError: string | null;

  @Column({ name: 'graph_sync_status', type: 'text', default: 'pending' })
  graphSyncStatus: DocumentGraphSyncStatus;

  @Column({ name: 'graph_sync_error', type: 'text', nullable: true })
  graphSyncError: string | null;

  @Column({ name: 'graph_synced_at', type: 'timestamptz', nullable: true })
  graphSyncedAt: Date | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  tags: string[];

  @Column({ type: 'text', nullable: true })
  department: string | null;

  @Column({ name: 'business_category', type: 'text', nullable: true })
  businessCategory: string | null;

  @Column({ type: 'text', default: 'company' })
  visibility: DocumentVisibility;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'version_group_id', type: 'uuid', nullable: true })
  versionGroupId: string | null;

  @Column({ name: 'version_no', type: 'int', default: 1 })
  versionNo: number;

  @Column({ name: 'is_current_version', type: 'boolean', default: true })
  isCurrentVersion: boolean;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @Column({ name: 'original_storage_key', type: 'text', nullable: true })
  originalStorageKey: string | null;

  @Column({ name: 'markdown_storage_key', type: 'text', nullable: true })
  markdownStorageKey: string | null;

  @Column({ name: 'parse_result_storage_key', type: 'text', nullable: true })
  parseResultStorageKey: string | null;

  @Column({ name: 'chunk_manifest_storage_key', type: 'text', nullable: true })
  chunkManifestStorageKey: string | null;

  @Column({ name: 'parse_strategy', type: 'text', nullable: true })
  parseStrategy: string | null;

  @Column({ name: 'parser_version', type: 'text', nullable: true })
  parserVersion: string | null;

  @Column({ name: 'asset_count', type: 'int', default: 0 })
  assetCount: number;

  @Column({ name: 'current_ingest_run_id', type: 'uuid', nullable: true })
  currentIngestRunId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
