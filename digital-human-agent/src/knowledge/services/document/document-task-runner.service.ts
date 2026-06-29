import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DocumentTask,
  type DocumentTaskStatus,
} from '@/knowledge/entities/document-task.entity';
import {
  DocumentTaskStep,
  type DocumentTaskStepName,
  type DocumentTaskStepStatus,
} from '@/knowledge/entities/document-task-step.entity';
import { KnowledgeDocumentService } from '@/knowledge/services/document/knowledge-document.service';
import type { UploadTaskExecutionInput } from './document-task.types';

type TaskPatch = Partial<
  Pick<
    DocumentTask,
    | 'documentId'
    | 'status'
    | 'stage'
    | 'progress'
    | 'error'
    | 'checkpointData'
    | 'startedAt'
    | 'finishedAt'
  >
>;
type StepPatch = Partial<
  Pick<
    DocumentTaskStep,
    | 'documentId'
    | 'status'
    | 'checkpoint'
    | 'error'
    | 'startedAt'
    | 'finishedAt'
  >
>;

@Injectable()
export class DocumentTaskRunnerService {
  private readonly logger = new Logger(DocumentTaskRunnerService.name);

  constructor(
    @InjectRepository(DocumentTask)
    private readonly taskRepo: Repository<DocumentTask>,
    @InjectRepository(DocumentTaskStep)
    private readonly stepRepo: Repository<DocumentTaskStep>,
    private readonly documentService: KnowledgeDocumentService,
  ) {}

  async runUploadIngestTask(params: UploadTaskExecutionInput): Promise<void> {
    const { taskId, knowledgeBaseId, file, input } = params;
    await this.updateTask(taskId, {
      status: 'running',
      stage: 'parsing',
      progress: 10,
      startedAt: new Date(),
    });
    await this.updateStep(taskId, 'parse', {
      status: 'running',
      startedAt: new Date(),
    });

    try {
      const document = await this.documentService.parseAndIngestDocument(
        knowledgeBaseId,
        file,
        input,
      );

      const checkpoint = {
        documentId: document.id,
        legacyPipeline: true,
        note: '当前切片复用旧 parseAndIngestDocument，后续再拆分 parse 和 index。',
      };

      await this.updateStep(taskId, 'parse', {
        status: 'completed',
        documentId: document.id,
        checkpoint,
        finishedAt: new Date(),
      });
      await this.updateStep(taskId, 'index', {
        status: 'completed',
        documentId: document.id,
        checkpoint: {
          ...checkpoint,
          chunkCount: document.chunkCount,
          processingStage: document.processingStage,
        },
        startedAt: new Date(),
        finishedAt: new Date(),
      });
      await this.updateStep(taskId, 'graph_sync', {
        status: 'skipped',
        documentId: document.id,
        checkpoint: {
          reason: '旧流水线内部已调度图谱同步，本任务切片暂不重复执行。',
          graphSyncStatus: document.graphSyncStatus,
        },
        startedAt: new Date(),
        finishedAt: new Date(),
      });
      await this.updateTask(taskId, {
        documentId: document.id,
        status: 'completed',
        stage: 'completed',
        progress: 100,
        checkpointData: {
          documentId: document.id,
          chunkCount: document.chunkCount,
          processingStage: document.processingStage,
          graphSyncStatus: document.graphSyncStatus,
        },
        finishedAt: new Date(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`文档任务执行失败 task=${taskId}: ${message}`);
      await this.updateStep(taskId, 'parse', {
        status: 'failed',
        error: message,
        finishedAt: new Date(),
      });
      await this.updateTask(taskId, {
        status: 'failed',
        stage: 'failed',
        progress: 100,
        error: message,
        finishedAt: new Date(),
      });
    }
  }

  private async updateTask(taskId: string, patch: TaskPatch): Promise<void> {
    await this.taskRepo.update(taskId, patch as never);
  }

  private async updateStep(
    taskId: string,
    step: DocumentTaskStepName,
    patch: StepPatch & { status?: DocumentTaskStepStatus },
  ): Promise<void> {
    await this.stepRepo.update({ taskId, step }, patch as never);
  }
}
