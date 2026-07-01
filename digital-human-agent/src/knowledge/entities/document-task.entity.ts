import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';

export type DocumentTaskStatus = 'pending' | 'running' | 'completed' | 'failed';
export type DocumentTaskType = 'upload_ingest';

@Entity('document_task')
export class DocumentTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id', type: 'uuid', nullable: true })
  documentId: string | null;

  @ManyToOne(() => KnowledgeDocument, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'document_id' })
  document: KnowledgeDocument | null;

  @Column({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId: string;

  @Column({ name: 'job_id', type: 'varchar', length: 255, nullable: true })
  jobId: string | null;

  @Column({ name: 'task_type', type: 'varchar', length: 50 })
  taskType: string;

  @Column({ type: 'varchar', length: 50 })
  status: string;

  @Column({ type: 'varchar', length: 50 })
  stage: string;

  @Column({ type: 'int', default: 0 })
  progress: number;

  @Column({ type: 'int', default: 0 })
  attempt: number;

  @Column({ name: 'max_attempts', type: 'int', default: 3 })
  maxAttempts: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'ingest_run_id', type: 'uuid', nullable: true })
  ingestRunId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @Column({ name: 'checkpoint_data', type: 'jsonb', nullable: true })
  checkpointData: Record<string, any> | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
