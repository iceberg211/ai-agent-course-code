import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Task } from './task.entity';

export enum ArtifactType {
  MARKDOWN = 'markdown',
  FILE = 'file',
  SCREENSHOT = 'screenshot',
  SUMMARY = 'summary',
}

@Entity('artifact')
export class Artifact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  taskId: string;

  @ManyToOne(() => Task, (task) => task.artifacts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'taskId' })
  task: Task;

  @Column({ type: 'enum', enum: ArtifactType })
  type: ArtifactType;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  content: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  filePath: string;

  @CreateDateColumn()
  createdAt: Date;
}
