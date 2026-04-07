import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { StepStatus, ExecutorType } from '../../common/enums';
import { TaskRun } from './task-run.entity';
import { PlanStep } from './plan-step.entity';

@Entity('step_runs')
@Unique(['runId', 'executionOrder'])
export class StepRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @Index()
  @Column({ name: 'plan_step_id', type: 'uuid' })
  planStepId: string;

  @Column({ name: 'execution_order', type: 'int' })
  executionOrder: number;

  @Column({ type: 'enum', enum: StepStatus, default: StepStatus.PENDING })
  status: StepStatus;

  @Column({
    name: 'executor_type',
    type: 'enum',
    enum: ExecutorType,
    default: ExecutorType.TOOL,
  })
  executorType: ExecutorType;

  @Column({ name: 'skill_name', type: 'varchar', nullable: true })
  skillName: string | null;

  @Column({ name: 'tool_name', type: 'varchar', nullable: true })
  toolName: string | null;

  @Column({ name: 'tool_input', type: 'jsonb', nullable: true })
  toolInput: Record<string, unknown> | null;

  @Column({ name: 'tool_output', type: 'text', nullable: true })
  toolOutput: string | null;

  @Column({ name: 'skill_trace', type: 'jsonb', nullable: true })
  skillTrace: Array<{ tool: string; input: unknown; output: string }> | null;

  @Column({ name: 'llm_reasoning', type: 'text', nullable: true })
  llmReasoning: string | null;

  @Column({ name: 'result_summary', type: 'text', nullable: true })
  resultSummary: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => TaskRun, (r) => r.stepRuns)
  @JoinColumn({ name: 'run_id' })
  run: TaskRun;

  @ManyToOne(() => PlanStep, (s) => s.stepRuns)
  @JoinColumn({ name: 'plan_step_id' })
  planStep: PlanStep;
}
