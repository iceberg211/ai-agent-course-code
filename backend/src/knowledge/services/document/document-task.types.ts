import type { DocumentTask } from '@/knowledge/entities/document-task.entity';
import type { DocumentTaskStep } from '@/knowledge/entities/document-task-step.entity';
import type { UploadDocumentDto } from '@/knowledge/dto/upload-document.dto';

export type UploadTaskFileInput = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

export type UploadTaskInput = Omit<
  UploadDocumentDto,
  'tags' | 'department' | 'businessCategory' | 'expiresAt'
> & {
  ownerId?: string | null;
  tags?: string | string[];
  department?: string | null;
  businessCategory?: string | null;
  expiresAt?: string | null;
  currentIngestRunId?: string | null;
  baseDocumentId?: string | null;
  versionGroupId?: string | null;
  versionNo?: number;
  isCurrentVersion?: boolean;
};

export type UploadTaskExecutionInput = {
  taskId: string;
  knowledgeBaseId: string;
  file: UploadTaskFileInput;
  input: UploadTaskInput;
};

export type DocumentTaskDetail = DocumentTask & { steps: DocumentTaskStep[] };

export interface DocumentJobData {
  taskId: string;
  knowledgeBaseId: string;
  originalStorageKey: string;
  filename: string;
  mimetype: string;
  size: number;
  input: UploadTaskInput;
}
