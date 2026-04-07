import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Unique,
  Index,
} from 'typeorm';
import { RunStatus } from '@/common/enums';
import { Task } from '@/task/entities/task.entity';
import { TaskRevision } from '@/task/entities/task-revision.entity';
import { TaskPlan } from '@/task/entities/task-plan.entity';
import { StepRun } from '@/task/entities/step-run.entity';
import { Artifact } from '@/task/entities/artifact.entity';

@Entity('task_runs')
@Unique(['revisionId', 'runNumber'])
export class TaskRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @Column({ name: 'revision_id', type: 'uuid' })
  revisionId: string;

  @Index()
  @Column({ type: 'enum', enum: RunStatus, default: RunStatus.PENDING })
  status: RunStatus;

  @Column({ name: 'run_number', type: 'int', default: 1 })
  runNumber: number;

  @Column({ name: 'cancel_requested', type: 'boolean', default: false })
  cancelRequested: boolean;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Task, (t) => t.runs)
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @ManyToOne(() => TaskRevision, (r) => r.runs)
  @JoinColumn({ name: 'revision_id' })
  revision: TaskRevision;

  @OneToMany(() => TaskPlan, (p) => p.run)
  plans: TaskPlan[];

  @OneToMany(() => StepRun, (s) => s.run)
  stepRuns: StepRun[];

  @OneToMany(() => Artifact, (a) => a.run)
  artifacts: Artifact[];
}
