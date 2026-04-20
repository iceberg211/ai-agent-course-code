import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface KnowledgeBaseRetrievalConfig {
  retrievalMode: 'vector' | 'keyword' | 'hybrid';
  threshold: number;
  stage1TopK: number;
  vectorTopK: number;
  keywordTopK: number;
  finalTopK: number;
  rerank: boolean;
  fusion: {
    method: 'rrf';
    rrfK: number;
    vectorWeight: number;
    keywordWeight: number;
  };
}

@Entity('knowledge_base')
export class KnowledgeBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'owner_persona_id', type: 'uuid', nullable: true })
  ownerPersonaId: string | null;

  @Column({ name: 'retrieval_config', type: 'jsonb' })
  retrievalConfig: KnowledgeBaseRetrievalConfig;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
