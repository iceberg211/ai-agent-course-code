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
import { TaskRun } from './task-run.entity';
import { PlanStep } from './plan-step.entity';

@Entity('task_plans')
@Unique(['runId', 'version'])
export class TaskPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => TaskRun, (r) => r.plans)
  @JoinColumn({ name: 'run_id' })
  run: TaskRun;

  @OneToMany(() => PlanStep, (s) => s.plan, { cascade: true })
  steps: PlanStep[];
}
