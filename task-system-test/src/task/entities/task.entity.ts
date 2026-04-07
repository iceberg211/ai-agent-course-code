import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { TaskPlan } from './task-plan.entity';
import { TaskStepRun } from './task-step-run.entity';
import { Artifact } from './artifact.entity';

export enum TaskStatus {
  PENDING = 'pending',
  PLANNING = 'planning',
  RUNNING = 'running',
  WAITING_HUMAN = 'waiting_human',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Entity('task')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  userInput: string;

  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.PENDING })
  status: TaskStatus;

  @Column({ type: 'int', default: 0 })
  currentStepIndex: number;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => TaskPlan, (plan) => plan.task)
  plans: TaskPlan[];

  @OneToMany(() => TaskStepRun, (stepRun) => stepRun.task)
  stepRuns: TaskStepRun[];

  @OneToMany(() => Artifact, (artifact) => artifact.task)
  artifacts: Artifact[];
}
