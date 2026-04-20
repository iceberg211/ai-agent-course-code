import {
  CreateDateColumn,
  Entity,
  PrimaryColumn,
} from 'typeorm';

@Entity('persona_knowledge_base')
export class PersonaKnowledge {
  @PrimaryColumn({ name: 'persona_id', type: 'uuid' })
  personaId: string;

  @PrimaryColumn({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
