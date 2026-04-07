import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Task } from './task.entity';

@Entity('task_plan')
export class TaskPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  taskId: string;

  @ManyToOne(() => Task, (task) => task.plans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'taskId' })
  task: Task;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'text' })
  goal: string;

  @Column({ type: 'json' })
  stepsJson: any; // e.g. [{ title: '...', description: '...' }]

  @CreateDateColumn()
  createdAt: Date;
}
