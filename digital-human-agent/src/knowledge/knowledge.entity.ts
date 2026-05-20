import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface KnowledgeRetrievalConfig {
  threshold: number;
  retrievalLimit: number;
  rerankLimit: number;
  rerank: boolean;
  /** @deprecated 旧版字段兼容 */
  stage1TopK?: number;
  /** @deprecated 旧版字段兼容 */
  finalTopK?: number;
}

@Entity('knowledge_base')
export class Knowledge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'owner_persona_id', type: 'uuid', nullable: true })
  ownerPersonaId: string | null;

  @Column({ name: 'retrieval_config', type: 'jsonb' })
  retrievalConfig: KnowledgeRetrievalConfig;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
