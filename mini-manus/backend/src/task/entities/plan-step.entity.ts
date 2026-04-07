import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Unique,
} from 'typeorm';
import { TaskPlan } from './task-plan.entity';
import { StepRun } from './step-run.entity';

@Entity('plan_steps')
@Unique(['planId', 'stepIndex'])
export class PlanStep {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @Column({ name: 'step_index', type: 'int' })
  stepIndex: number;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'skill_name', type: 'varchar', nullable: true })
  skillName: string | null;

  @Column({ name: 'skill_input', type: 'jsonb', nullable: true })
  skillInput: Record<string, unknown> | null;

  @Column({ name: 'tool_hint', type: 'varchar', nullable: true })
  toolHint: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => TaskPlan, (p) => p.steps)
  @JoinColumn({ name: 'plan_id' })
  plan: TaskPlan;

  @OneToMany(() => StepRun, (s) => s.planStep)
  stepRuns: StepRun[];
}
