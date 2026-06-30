import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AclSubjectType = 'user' | 'role' | 'department';
export type AclResourceAction = 'read' | 'write' | 'delete' | 'manage';
export type AclEffect = 'allow' | 'deny';

export abstract class ResourceAclBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subject_type', type: 'text' })
  subjectType: AclSubjectType;

  @Column({ name: 'subject_id', type: 'text' })
  subjectId: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  actions: AclResourceAction[];

  @Column({ type: 'text', default: 'allow' })
  effect: AclEffect;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('document_acl')
export class DocumentAclEntity extends ResourceAclBase {
  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;
}

@Entity('knowledge_base_acl')
export class KnowledgeBaseAclEntity extends ResourceAclBase {
  @Column({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId: string;
}
