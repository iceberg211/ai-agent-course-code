import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DocumentTask } from '@/knowledge/entities/document-task.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';

export type DocumentTaskStepName = 'parse' | 'index' | 'graph_sync';
export type DocumentTaskStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

@Entity('document_task_step')
export class DocumentTaskStep {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @ManyToOne(() => DocumentTask, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: DocumentTask;

  @Column({ name: 'document_id', type: 'uuid', nullable: true })
  documentId: string | null;

  @ManyToOne(() => KnowledgeDocument, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'document_id' })
  document: KnowledgeDocument | null;

  @Column({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId: string;

  @Column({ type: 'text' })
  step: DocumentTaskStepName;

  @Column({ type: 'text', default: 'pending' })
  status: DocumentTaskStepStatus;

  @Column({ type: 'int', default: 0 })
  attempt: number;

  @Column({ name: 'input_hash', type: 'text', nullable: true })
  inputHash: string | null;

  @Column({ name: 'output_hash', type: 'text', nullable: true })
  outputHash: string | null;

  @Column({ type: 'jsonb', nullable: true })
  checkpoint: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
