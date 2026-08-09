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

@Entity('knowledge_eval_case')
export class KnowledgeEvalCase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId: string;

  @ManyToOne(() => Knowledge, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'knowledge_base_id' })
  knowledge: Knowledge;

  @Column({ type: 'text' })
  question: string;

  @Column({ name: 'expected_answer', type: 'text', nullable: true })
  expectedAnswer: string | null;

  @Column({ name: 'last_run_actual_answer', type: 'text', nullable: true })
  lastRunActualAnswer: string | null;

  @Column({ name: 'last_run_status', type: 'varchar', default: 'unrun' })
  lastRunStatus: string;

  @Column({ name: 'last_run_hit_rate', type: 'double precision', nullable: true })
  lastRunHitRate: number | null;

  @Column({ name: 'last_run_recall', type: 'double precision', nullable: true })
  lastRunRecall: number | null;

  @Column({ name: 'last_run_hit_at_1', type: 'double precision', nullable: true })
  lastRunHitAt1: number | null;

  @Column({ name: 'last_run_hit_at_3', type: 'double precision', nullable: true })
  lastRunHitAt3: number | null;

  @Column({ name: 'last_run_recall_at_5', type: 'double precision', nullable: true })
  lastRunRecallAt5: number | null;

  @Column({ name: 'last_run_recall_at_10', type: 'double precision', nullable: true })
  lastRunRecallAt10: number | null;

  @Column({ name: 'last_run_retrieval_latency_ms', type: 'int', nullable: true })
  lastRunRetrievalLatencyMs: number | null;

  @Column({ name: 'last_run_rerank_latency_ms', type: 'int', nullable: true })
  lastRunRerankLatencyMs: number | null;

  @Column({ name: 'last_run_error', type: 'text', nullable: true })
  lastRunError: string | null;

  @Column({ name: 'user_review_status', type: 'varchar', default: 'unreviewed' })
  userReviewStatus: string;

  @Column({ name: 'last_run_at', type: 'timestamptz', nullable: true })
  lastRunAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
