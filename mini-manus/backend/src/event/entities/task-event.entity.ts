import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('task_events')
@Index(['taskId', 'createdAt'])
@Index(['runId', 'createdAt'])
export class TaskEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId: string | null;

  @Index()
  @Column({ name: 'run_id', type: 'uuid', nullable: true })
  runId: string | null;

  @Column({ name: 'event_name', type: 'varchar', length: 120 })
  eventName: string;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
