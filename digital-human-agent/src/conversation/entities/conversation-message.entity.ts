import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Conversation } from '@/conversation/entities/conversation.entity';

export type MessageRole = 'user' | 'assistant';
export type MessageStatus = 'completed' | 'interrupted' | 'failed';
export type MessageFeedback = 'up' | 'down';

@Entity('conversation_message')
export class ConversationMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'conversation_id' })
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ name: 'turn_id' })
  turnId: string;

  @Column()
  role: MessageRole;

  @Column({ default: 0 })
  seq: number;

  @Column()
  content: string;

  @Column({ default: 'completed' })
  status: MessageStatus;

  @Column({ type: 'jsonb', nullable: true })
  citations: unknown[] | null;

  @Column({ name: 'rag_trace', type: 'jsonb', nullable: true })
  ragTrace: Record<string, unknown> | null;

  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs: number | null;

  @Column({ type: 'text', nullable: true })
  feedback: MessageFeedback | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
