import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
} from 'typeorm';
import { Persona } from '../persona/persona.entity';

export type DocumentStatus = 'pending' | 'processing' | 'completed' | 'failed';

@Entity('knowledge_document')
export class KnowledgeDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'persona_id' })
  personaId: string;

  @ManyToOne(() => Persona, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'persona_id' })
  persona: Persona;

  @Column()
  filename: string;

  @Column({ default: 'pending' })
  status: DocumentStatus;

  @Column({ name: 'chunk_count', default: 0 })
  chunkCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
