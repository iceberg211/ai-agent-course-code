import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  JoinColumn,
  Index,
  ManyToOne,
} from 'typeorm';
import { TaskRun } from '@/task/entities/task-run.entity';

/**
 * LlmCallLog — 记录单次 LLM 调用的 token 用量和成本。
 *
 * 每次 planner / evaluator / finalizer / skill 内部 LLM 调用都写一条记录。
 * 通过 node_name 区分来源，可以回答"哪个节点最烧钱"。
 *
 * P24：节点级 token 明细（§13 优先级 24）
 */
@Entity('llm_call_logs')
export class LlmCallLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @ManyToOne(() => TaskRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: TaskRun;

  /** 调用来源节点名称，约定值：planner / evaluator / finalizer / skill:<name> */
  @Column({ name: 'node_name', type: 'varchar', length: 64 })
  nodeName: string;

  @Column({ name: 'model_name', type: 'varchar', length: 128, nullable: true })
  modelName: string | null;

  @Column({ name: 'input_tokens', type: 'int', default: 0 })
  inputTokens: number;

  @Column({ name: 'output_tokens', type: 'int', default: 0 })
  outputTokens: number;

  @Column({ name: 'total_tokens', type: 'int', default: 0 })
  totalTokens: number;

  @Column({
    name: 'estimated_cost_usd',
    type: 'decimal',
    precision: 10,
    scale: 6,
    nullable: true,
  })
  estimatedCostUsd: number | null;

  /** LLM 请求耗时（ms），用于排查慢查询 */
  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
