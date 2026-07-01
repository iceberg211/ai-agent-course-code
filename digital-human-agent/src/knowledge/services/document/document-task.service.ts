import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Brackets, In, Repository } from 'typeorm';
import { normalizePage, normalizePageSize } from '@/common/utils';
import { DocumentTask } from '@/knowledge/entities/document-task.entity';
import {
  DocumentTaskStep,
  type DocumentTaskStepName,
} from '@/knowledge/entities/document-task-step.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import type { KnowledgeAccessScope } from '@/knowledge/types/knowledge-content.types';
import { isDocumentVisibleToScope } from '@/knowledge/utils/document-access.util';
import { QueueService } from '@/queue/queue.service';
import { ObjectStorageProviderToken } from '@/storage/object-storage.provider';
import type { ObjectStorageProvider } from '@/storage/object-storage.provider';
import type {
  DocumentTaskDetail,
  UploadTaskFileInput,
  UploadTaskInput,
} from './document-task.types';

@Injectable()
export class DocumentTaskService {
  constructor(
    @InjectRepository(DocumentTask)
    private readonly taskRepo: Repository<DocumentTask>,
    @InjectRepository(DocumentTaskStep)
    private readonly stepRepo: Repository<DocumentTaskStep>,
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepo: Repository<KnowledgeDocument>,
    private readonly configService: ConfigService,
    private readonly queueService: QueueService,
    @Inject(ObjectStorageProviderToken)
    private readonly storageProvider: ObjectStorageProvider,
  ) {}

  async createUploadIngestTask(
    knowledgeBaseId: string,
    file: UploadTaskFileInput,
    input: UploadTaskInput,
  ): Promise<DocumentTaskDetail> {
    const ingestRunId = randomUUID();
    const storageKey = `knowledge-bases/${knowledgeBaseId}/original/${ingestRunId}-${file.originalname}`;
    const bucket =
      this.configService.get<string>('S3_BUCKET') || 'enterprise-kb';

    // 1. 上传原始文件到 S3 对象存储
    await this.storageProvider.putObject({
      bucket,
      key: storageKey,
      body: file.buffer,
      contentType: file.mimetype,
    });

    // 2. 保存任务主体状态
    const task = await this.taskRepo.save(
      this.taskRepo.create({
        knowledgeBaseId,
        taskType: 'upload_ingest',
        status: 'pending',
        stage: 'uploaded',
        progress: 0,
        ingestRunId,
        metadata: {
          filename: file.originalname,
          mimeType: file.mimetype,
          fileSize: file.size,
          upload: this.safeUploadMetadata(input),
          executionMode: 'bullmq',
          originalStorageKey: storageKey,
        },
        checkpointData: {
          originalStorageKey: storageKey,
        },
      }),
    );

    // 3. 创建初始任务步骤
    await this.createInitialSteps(task);

    const taskInput: UploadTaskInput = {
      ...input,
      currentIngestRunId: ingestRunId,
    };

    try {
      await this.enqueueParseAndIndexJob(task.id, {
        knowledgeBaseId,
        originalStorageKey: storageKey,
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        input: taskInput,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.markTaskFailed(
        task.id,
        `任务发布失败: ${errorMessage}`,
      );
      throw new BadRequestException('文档处理任务发布失败，请稍后重试');
    }

    return this.getTaskDetail(task.id, {
      ownerId: input.ownerId ?? null,
      department: input.department ?? null,
      role: null,
    });
  }

  async createUploadVersionTask(
    knowledgeBaseId: string,
    baseDocumentId: string,
    file: UploadTaskFileInput,
    input: UploadTaskInput,
    accessScope?: KnowledgeAccessScope,
  ): Promise<DocumentTaskDetail> {
    const base = await this.documentRepo.findOne({
      where: { id: baseDocumentId, knowledgeBaseId },
    });
    if (!base) {
      throw new NotFoundException('基础文档不存在');
    }
    if (!isDocumentVisibleToScope(base, accessScope)) {
      throw new ForbiddenException('无权访问该文档');
    }
    this.assertDocumentWritable(base, accessScope);

    const versionGroupId = base.versionGroupId ?? base.id;
    if (!base.versionGroupId) {
      await this.documentRepo.update(base.id, { versionGroupId });
    }
    const latest = await this.documentRepo.findOne({
      where: { knowledgeBaseId, versionGroupId },
      order: { versionNo: 'DESC' },
    });

    const versionInput: UploadTaskInput = {
      ...input,
      tags: input.tags ?? base.tags,
      department: input.department ?? base.department,
      businessCategory: input.businessCategory ?? base.businessCategory,
      visibility: input.visibility ?? base.visibility,
      expiresAt: input.expiresAt ?? base.expiresAt?.toISOString(),
      baseDocumentId,
      versionGroupId,
      versionNo: (latest?.versionNo ?? base.versionNo ?? 1) + 1,
      isCurrentVersion: true,
    };

    return this.createUploadIngestTask(knowledgeBaseId, file, versionInput);
  }

  async getTaskDetail(
    taskId: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<DocumentTaskDetail> {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException('任务不存在');
    }
    await this.assertTaskVisible(task, accessScope);
    const steps = await this.stepRepo.find({
      where: { taskId },
      order: { createdAt: 'ASC' },
    });
    return Object.assign(task, { steps });
  }

  async listTasksByDocument(
    documentId: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<DocumentTaskDetail[]> {
    await this.assertDocumentVisible(documentId, accessScope);
    const tasks = await this.taskRepo.find({
      where: { documentId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    const result: DocumentTaskDetail[] = [];
    for (const task of tasks) {
      const steps = await this.stepRepo.find({
        where: { taskId: task.id },
        order: { createdAt: 'ASC' },
      });
      result.push(Object.assign(task, { steps }));
    }
    return result;
  }

  async listTasks(
    filters: {
      knowledgeBaseId?: string;
      documentId?: string;
      taskType?: DocumentTask['taskType'];
      status?: DocumentTask['status'];
      stage?: string;
      page?: number;
      pageSize?: number;
      accessScope?: KnowledgeAccessScope;
    } = {},
  ): Promise<{
    items: DocumentTaskDetail[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = normalizePage(filters.page);
    const pageSize = normalizePageSize(filters.pageSize);
    const qb = this.taskRepo
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.document', 'document')
      .orderBy('task.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    if (filters.knowledgeBaseId) {
      qb.andWhere('task.knowledge_base_id = :knowledgeBaseId', {
        knowledgeBaseId: filters.knowledgeBaseId,
      });
    }
    if (filters.documentId) {
      qb.andWhere('task.document_id = :documentId', {
        documentId: filters.documentId,
      });
    }
    if (filters.taskType) {
      qb.andWhere('task.task_type = :taskType', { taskType: filters.taskType });
    }
    if (filters.status) {
      qb.andWhere('task.status = :status', { status: filters.status });
    }
    if (filters.stage) {
      qb.andWhere('task.stage = :stage', { stage: filters.stage });
    }

    this.applyTaskAccessScope(qb, filters.accessScope);

    const [tasks, total] = await qb.getManyAndCount();
    const taskIds = tasks.map((task) => task.id);
    if (taskIds.length === 0) {
      return { items: [], total, page, pageSize };
    }

    const steps = await this.stepRepo.find({
      where: { taskId: In(taskIds) },
      order: { createdAt: 'ASC' },
    });
    const stepsByTaskId = new Map<string, DocumentTaskStep[]>();
    for (const step of steps) {
      const list = stepsByTaskId.get(step.taskId) ?? [];
      list.push(step);
      stepsByTaskId.set(step.taskId, list);
    }

    return {
      items: tasks.map((task) =>
        Object.assign(task, { steps: stepsByTaskId.get(task.id) ?? [] }),
      ),
      total,
      page,
      pageSize,
    };
  }

  async retryTask(
    taskId: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<DocumentTaskDetail> {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException('任务不存在');
    }
    await this.assertTaskVisible(task, accessScope);
    if (task.status !== 'failed') {
      throw new BadRequestException('仅失败任务支持重试');
    }

    const originalStorageKey =
      task.metadata?.originalStorageKey ||
      task.checkpointData?.originalStorageKey;
    if (!originalStorageKey) {
      throw new BadRequestException(
        '该任务无可用对象存储 Key 备份，无法重试；请重新上传文件。',
      );
    }

    // 重置任务和步骤状态
    await this.taskRepo.update(taskId, {
      status: 'pending',
      stage: 'uploaded',
      progress: 0,
      error: null,
    });
    await this.stepRepo.update({ taskId }, {
      status: 'pending',
      error: null,
      startedAt: null,
      finishedAt: null,
    });

    try {
      await this.enqueueParseAndIndexJob(task.id, {
        knowledgeBaseId: task.knowledgeBaseId,
        originalStorageKey,
        filename: task.metadata?.filename || 'document',
        mimetype: task.metadata?.mimeType || 'application/octet-stream',
        size: task.metadata?.fileSize || 0,
        input: {
          ...task.metadata?.upload,
          currentIngestRunId: task.ingestRunId,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.markTaskFailed(
        taskId,
        `任务发布失败: ${errorMessage}`,
      );
      throw new BadRequestException('文档处理任务发布失败，请稍后重试');
    }

    return this.getTaskDetail(taskId, accessScope);
  }

  async markTaskFailed(
    taskId: string,
    error: string,
    stage = 'failed',
  ): Promise<void> {
    await this.taskRepo.update(taskId, {
      status: 'failed',
      stage,
      progress: 0,
      error,
      finishedAt: new Date(),
    });
    await this.stepRepo.update(
      { taskId, status: 'running' },
      {
        status: 'failed',
        error,
        finishedAt: new Date(),
      },
    );
  }

  private async enqueueParseAndIndexJob(
    taskId: string,
    data: {
      knowledgeBaseId: string;
      originalStorageKey: string;
      filename: string;
      mimetype: string;
      size: number;
      input: UploadTaskInput;
    },
  ): Promise<void> {
    const queue = this.queueService.getQueue('document-processing');
    const job = await queue.add('parse_and_index', {
      taskId,
      ...data,
    });
    await this.taskRepo.update(taskId, { jobId: job.id });
  }

  private async createInitialSteps(task: DocumentTask): Promise<void> {
    const steps: DocumentTaskStepName[] = ['parse', 'index', 'graph_sync'];
    await this.stepRepo.save(
      steps.map((step) =>
        this.stepRepo.create({
          taskId: task.id,
          knowledgeBaseId: task.knowledgeBaseId,
          step,
          status: 'pending',
        }),
      ),
    );
  }

  private async assertTaskVisible(
    task: DocumentTask,
    scope?: KnowledgeAccessScope,
  ): Promise<void> {
    if (!scope || scope.role === 'admin') return;

    if (task.documentId) {
      await this.assertDocumentVisible(task.documentId, scope);
      return;
    }

    const ownerId = this.readTaskOwnerId(task);
    if (ownerId && scope.ownerId && ownerId === scope.ownerId) {
      return;
    }

    throw new ForbiddenException('无权访问该文档处理任务');
  }

  private async assertDocumentVisible(
    documentId: string,
    scope?: KnowledgeAccessScope,
  ): Promise<void> {
    if (!scope || scope.role === 'admin') return;

    const document = await this.documentRepo.findOne({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException('文档不存在');
    }
    if (!isDocumentVisibleToScope(document, scope)) {
      throw new ForbiddenException('无权访问该文档处理任务');
    }
  }

  private assertDocumentWritable(
    document: Pick<KnowledgeDocument, 'ownerId'>,
    scope?: KnowledgeAccessScope,
  ): void {
    if (!scope || scope.role === 'admin') return;
    if (scope.ownerId && document.ownerId === scope.ownerId) return;
    throw new ForbiddenException('无权修改该文档');
  }

  private readTaskOwnerId(task: DocumentTask): string | null {
    const metadata = task.metadata;
    if (!metadata || typeof metadata !== 'object') return null;
    const upload = metadata.upload;
    if (!upload || typeof upload !== 'object') return null;
    const ownerId = (upload as Record<string, unknown>).ownerId;
    return typeof ownerId === 'string' && ownerId.trim() ? ownerId : null;
  }

  private applyTaskAccessScope(
    qb: ReturnType<Repository<DocumentTask>['createQueryBuilder']>,
    scope?: KnowledgeAccessScope,
  ): void {
    if (!scope || scope.role === 'admin') return;

    const ownerId = scope.ownerId?.trim();
    const department = scope.department?.trim();

    qb.andWhere(
      new Brackets((where) => {
        where.where('document.visibility = :companyVisibility', {
          companyVisibility: 'company',
        });
        if (department) {
          where.orWhere(
            '(document.visibility = :departmentVisibility AND document.department = :accessDepartment)',
            {
              departmentVisibility: 'department',
              accessDepartment: department,
            },
          );
        }
        if (ownerId) {
          where.orWhere(
            '(document.visibility = :privateVisibility AND document.owner_id = :accessOwnerId)',
            {
              privateVisibility: 'private',
              accessOwnerId: ownerId,
            },
          );
          where.orWhere(
            "(task.document_id IS NULL AND task.metadata #>> '{upload,ownerId}' = :taskOwnerId)",
            { taskOwnerId: ownerId },
          );
        }
      }),
    );
  }

  private safeUploadMetadata(input: UploadTaskInput): Record<string, unknown> {
    return {
      ownerId: input.ownerId ?? null,
      category: input.category ?? null,
      tags: input.tags ?? null,
      department: input.department ?? null,
      businessCategory: input.businessCategory ?? null,
      visibility: input.visibility ?? null,
      expiresAt: input.expiresAt ?? null,
    };
  }
}
