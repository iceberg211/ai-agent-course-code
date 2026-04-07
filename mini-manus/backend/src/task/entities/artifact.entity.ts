import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ArtifactType } from '../../common/enums';
import { TaskRun } from './task-run.entity';

@Entity('artifacts')
export class Artifact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @Column({ type: 'enum', enum: ArtifactType, default: ArtifactType.MARKDOWN })
  type: ArtifactType;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => TaskRun, (r) => r.artifacts)
  @JoinColumn({ name: 'run_id' })
  run: TaskRun;
}
