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
import { Task } from '@/task/entities/task.entity';
import { TaskRun } from '@/task/entities/task-run.entity';

@Entity('task_revisions')
@Unique(['taskId', 'version'])
export class TaskRevision {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'text' })
  input: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Task, (t) => t.revisions)
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @OneToMany(() => TaskRun, (r) => r.revision)
  runs: TaskRun[];
}
