import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('document_asset')
export class DocumentAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @Column({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId: string;

  @Column({ name: 'asset_type', type: 'varchar', length: 50 })
  assetType: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100, nullable: true })
  mimeType: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  filename: string | null;

  @Column({ name: 'storage_key', type: 'varchar', length: 512 })
  storageKey: string;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ name: 'page_no', type: 'int', nullable: true })
  pageNo: number | null;

  @Column({ name: 'start_ms', type: 'int', nullable: true })
  startMs: number | null;

  @Column({ name: 'end_ms', type: 'int', nullable: true })
  endMs: number | null;

  @Column({ type: 'text', nullable: true })
  caption: string | null;

  @Column({ name: 'ocr_text', type: 'text', nullable: true })
  ocrText: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
