import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  MemoryCategory,
  MemoryVisibility,
} from '@/memory/memory.types';

@Entity('memory_record')
export class MemoryRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'text', nullable: true })
  department: string | null;

  @Column({ type: 'text', default: 'private' })
  visibility: MemoryVisibility;

  @Column({ type: 'text', default: 'preference' })
  category: MemoryCategory;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'source_conversation_id', type: 'uuid', nullable: true })
  sourceConversationId: string | null;

  @Column({ type: 'double precision', default: 0.7 })
  confidence: number;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

