import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { TaskStatus } from '@/common/enums';
import { TaskRevision } from '@/task/entities/task-revision.entity';
import { TaskRun } from '@/task/entities/task-run.entity';

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 500 })
  title: string;

  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.PENDING })
  status: TaskStatus;

  @Index()
  @Column({ name: 'current_revision_id', type: 'uuid', nullable: true })
  currentRevisionId: string | null;

  @Index()
  @Column({ name: 'current_run_id', type: 'uuid', nullable: true })
  currentRunId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => TaskRevision, (r) => r.task)
  revisions: TaskRevision[];

  @OneToMany(() => TaskRun, (r) => r.task)
  runs: TaskRun[];
}
