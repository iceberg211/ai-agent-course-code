import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { DocumentTask } from '@/knowledge/entities/document-task.entity';
import {
  DocumentTaskStep,
  type DocumentTaskStepName,
  type DocumentTaskStepStatus,
} from '@/knowledge/entities/document-task-step.entity';
import { KnowledgeDocumentService } from '@/knowledge/services/document/knowledge-document.service';
import { ObjectStorageProviderToken } from '@/storage/object-storage.provider';
import type { ObjectStorageProvider } from '@/storage/object-storage.provider';
import type { UploadTaskExecutionInput } from './document-task.types';
import { DocumentAsset } from '@/knowledge/entities/document-asset.entity';
import { DocumentParserService } from './parsers/document-parser.service';
import type { IngestKnowledgeDocumentOptions } from '@/knowledge/types/knowledge-content.types';
import { NotificationService } from '@/notification/notification.service';

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

async function streamToString(stream: Readable, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error(`Markdown 内容超过读取上限 ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

@Injectable()
export class DocumentTaskRunnerService {
  private readonly logger = new Logger(DocumentTaskRunnerService.name);

  constructor(
    @InjectRepository(DocumentTask)
    private readonly taskRepo: Repository<DocumentTask>,
    @InjectRepository(DocumentTaskStep)
    private readonly stepRepo: Repository<DocumentTaskStep>,
    @InjectRepository(DocumentAsset)
    private readonly assetRepo: Repository<DocumentAsset>,
    private readonly documentService: KnowledgeDocumentService,
    private readonly configService: ConfigService,
    @Inject(ObjectStorageProviderToken)
    private readonly storageProvider: ObjectStorageProvider,
    private readonly parserService: DocumentParserService,
    @Optional()
    private readonly notificationService?: NotificationService,
  ) {}

  async runUploadIngestTask(params: UploadTaskExecutionInput): Promise<void> {
    const { taskId, knowledgeBaseId, file, input } = params;

    // 1. 获取最新任务和步骤状态
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      this.logger.error(`[Runner] 任务未找到 taskId=${taskId}`);
      return;
    }

    const steps = await this.stepRepo.find({ where: { taskId } });
    const parseStep = steps.find((s) => s.step === 'parse');
    const indexStep = steps.find((s) => s.step === 'index');
    const graphSyncStep = steps.find((s) => s.step === 'graph_sync');

    if (!parseStep || !indexStep || !graphSyncStep) {
      this.logger.error(`[Runner] 任务步骤未完全初始化 taskId=${taskId}`);
      return;
    }

    await this.updateTask(taskId, {
      status: 'running',
      startedAt: new Date(),
    });

    const bucket = this.configService.get<string>('S3_BUCKET') || 'enterprise-kb';
    let documentId = task.documentId;
    let markdownStorageKey = (task.checkpointData as any)?.markdownStorageKey;
    const ingestRunId = task.ingestRunId ?? input.currentIngestRunId ?? crypto.randomUUID();
    const ingestOptions = this.toIngestOptions(input);

    // ==========================================
    // 步骤 1：Parse
    // ==========================================
    if (parseStep.status !== 'completed') {
      await this.updateTask(taskId, { stage: 'parsing', progress: 10 });
      await this.updateStep(taskId, 'parse', {
        status: 'running',
        startedAt: new Date(),
      });

      try {
        // 调用多模态解析器
        const parseResult = await this.parserService.parse(
          {
            filename: file.originalname,
            mimetype: file.mimetype,
            buffer: file.buffer,
            size: file.size,
          },
          {
            knowledgeBaseId,
            ingestRunId,
          },
        );
        
        markdownStorageKey = `knowledge-bases/${knowledgeBaseId}/markdown/${ingestRunId}.md`;
        const parseResultStorageKey = `knowledge-bases/${knowledgeBaseId}/parse-results/${ingestRunId}.json`;
        
        // 保存解析后的 Markdown 到 S3 对象存储
        await this.storageProvider.putObject({
          bucket,
          key: markdownStorageKey,
          body: Buffer.from(parseResult.markdown, 'utf-8'),
          contentType: 'text/markdown',
        });
        await this.storageProvider.putObject({
          bucket,
          key: parseResultStorageKey,
          body: Buffer.from(JSON.stringify(parseResult, null, 2), 'utf-8'),
          contentType: 'application/json',
        });

        // 创建/获取 KnowledgeDocument 占位符
        let document: any;
        if (!documentId) {
          document = await this.documentService.createDocument(
            knowledgeBaseId,
            file.originalname,
            file.size,
            file.mimetype,
            ingestOptions,
          );
          documentId = document.id;
        }

        if (!documentId) {
          throw new Error('创建/匹配文档记录失败');
        }
        const docId: string = documentId;

        // 保存多模态解析资产（图片、音频段、视频段）到数据库
        if (parseResult.assets && parseResult.assets.length > 0) {
          // 幂等防护：先清理掉之前因为本阶段解析中途失败产生的冗余多模态资产记录
          await this.assetRepo.delete({ documentId: docId });

          const assetEntities = parseResult.assets.map((asset) =>
            this.assetRepo.create({
              documentId: docId,
              knowledgeBaseId,
              assetType: asset.assetType,
              mimeType: asset.mimeType,
              filename: asset.filename,
              storageKey: asset.storageKey,
              pageNo: asset.pageNo ?? null,
              startMs: asset.startMs ?? null,
              endMs: asset.endMs ?? null,
              caption: asset.caption ?? null,
              ocrText: asset.ocrText ?? null,
              metadata: asset.metadata ?? null,
            }),
          );
          await this.assetRepo.save(assetEntities);

          // 更新文档中的资产计数
        }

        await this.documentService.updateDocument(docId, {
          originalStorageKey: (task.checkpointData as any)?.originalStorageKey ?? null,
          markdownStorageKey,
          parseResultStorageKey,
          parseStrategy: ingestOptions.parseStrategy ?? 'multimodal_parser',
          parserVersion: ingestOptions.parserVersion ?? 'multimodal-v1',
          assetCount: parseResult.assets?.length ?? 0,
        });

        // 绑定 documentId
        await this.updateStep(taskId, 'parse', {
          status: 'completed',
          documentId,
          checkpoint: { markdownStorageKey, parseResultStorageKey },
          finishedAt: new Date(),
        });

        await this.updateTask(taskId, {
          documentId,
          checkpointData: {
            ...(task.checkpointData || {}),
            markdownStorageKey,
            parseResultStorageKey,
            documentId,
            assetCount: parseResult.assets ? parseResult.assets.length : 0,
          },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await this.markDocumentFailed(documentId, errMsg, {
          knowledgeBaseId,
          filename: file.originalname,
          ownerId: input.ownerId ?? null,
          taskId,
          stage: 'parse',
        });
        await this.updateStep(taskId, 'parse', {
          status: 'failed',
          error: errMsg,
          finishedAt: new Date(),
        });
        await this.updateTask(taskId, {
          status: 'failed',
          stage: 'failed',
          error: `步骤 parse 失败: ${errMsg}`,
          finishedAt: new Date(),
        });
        return;
      }
    } else {
      // 已经完成过 parse，保证 documentId 正确加载
      documentId = parseStep.documentId;
      markdownStorageKey = (parseStep.checkpoint as any)?.markdownStorageKey || markdownStorageKey;
    }

    if (!documentId) {
      throw new Error('未关联的文档 ID，流程不可推进');
    }
    const docId: string = documentId;

    // ==========================================
    // 步骤 2：Index
    // ==========================================
    let chunkRows: any[] = [];
    if (indexStep.status !== 'completed') {
      await this.updateTask(taskId, { stage: 'indexing', progress: 50 });
      await this.updateStep(taskId, 'index', {
        status: 'running',
        startedAt: new Date(),
      });

      try {
        if (!markdownStorageKey) {
          throw new Error('解析步骤的 markdownStorageKey 丢失，无法执行索引');
        }

        // 从 S3/MinIO 下载已解析的 Markdown
        const stream = await this.storageProvider.getObject({
          bucket,
          key: markdownStorageKey,
        });
        const contentStr = await streamToString(stream, this.markdownReadMaxBytes);

        // 获取对应的 document
        const document = await this.documentService.findOneDocument(docId);
        if (!document) {
          throw new Error(`关联的文档记录不存在 id=${docId}`);
        }

        // 写入索引（分片、PG、ES）
        chunkRows = await this.documentService.indexDocumentChunks(
          document,
          knowledgeBaseId,
          file.originalname,
          contentStr,
          ingestOptions,
        );
        const chunkManifestStorageKey = `knowledge-bases/${knowledgeBaseId}/chunk-manifests/${task.ingestRunId ?? taskId}.json`;
        await this.storageProvider.putObject({
          bucket,
          key: chunkManifestStorageKey,
          body: Buffer.from(JSON.stringify(chunkRows, null, 2), 'utf-8'),
          contentType: 'application/json',
        });
        await this.documentService.updateDocument(docId, {
          chunkManifestStorageKey,
        });

        await this.updateStep(taskId, 'index', {
          status: 'completed',
          documentId: docId,
          checkpoint: {
            chunkCount: chunkRows.length,
            chunkManifestStorageKey,
          },
          finishedAt: new Date(),
        });

        await this.updateTask(taskId, {
          checkpointData: {
            ...(task.checkpointData || {}),
            markdownStorageKey,
            documentId: docId,
            chunkCount: chunkRows.length,
            chunkManifestStorageKey,
          },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await this.markDocumentFailed(docId, errMsg, {
          knowledgeBaseId,
          filename: file.originalname,
          ownerId: input.ownerId ?? null,
          taskId,
          stage: 'index',
        });
        await this.updateStep(taskId, 'index', {
          status: 'failed',
          error: errMsg,
          finishedAt: new Date(),
        });
        await this.updateTask(taskId, {
          status: 'failed',
          stage: 'failed',
          error: `步骤 index 失败: ${errMsg}`,
          finishedAt: new Date(),
        });
        return;
      }
    }

    // ==========================================
    // 步骤 3：Graph Sync
    // ==========================================
    if (graphSyncStep.status !== 'completed' && graphSyncStep.status !== 'skipped') {
      await this.updateTask(taskId, { stage: 'graph_syncing', progress: 80 });
      await this.updateStep(taskId, 'graph_sync', {
        status: 'running',
        startedAt: new Date(),
      });

      try {
        const document = await this.documentService.findOneDocument(docId);
        if (!document) {
          throw new Error(`关联的文档记录不存在 id=${docId}`);
        }

        // 如果在刚才 index 已经跑过了，直接用刚才返回 of chunkRows。
        // 如果 index 被跳过，就需要通过 listChunksByDocumentId 来读取。
        if (!chunkRows || chunkRows.length === 0) {
          const dbChunks = await this.documentService.listChunksByDocumentId(docId);
          chunkRows = dbChunks.map((c) => ({
            id: c.id,
            document_id: docId,
            chunk_index: c.chunkIndex,
            content: c.content,
            source: file.originalname,
            category: (input as any).category ?? null,
            enabled: c.enabled,
            embedding: '[]',
            source_asset_key: c.sourceAssetKey,
            start_ms: c.startMs,
            end_ms: c.endMs,
          }));
        }

        await this.documentService.syncGraphOnly(
          document,
          knowledgeBaseId,
          file.originalname,
          chunkRows,
        );

        await this.updateStep(taskId, 'graph_sync', {
          status: 'completed',
          documentId: docId,
          checkpoint: {
            graphSyncStatus: document.graphSyncStatus,
          },
          finishedAt: new Date(),
        });

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`图谱同步失败（不影响基础检索）：${errMsg}`);
        await this.markDocumentGraphFailed(docId, errMsg);
        await this.updateStep(taskId, 'graph_sync', {
          status: 'failed',
          error: errMsg,
          finishedAt: new Date(),
        });
      }
    }

    if (input.versionGroupId && docId) {
      await this.documentService.setCurrentDocumentVersion(
        knowledgeBaseId,
        docId,
      );
    }

    // 最终更新任务为完成
    await this.updateTask(taskId, {
      status: 'completed',
      stage: 'completed',
      progress: 100,
      finishedAt: new Date(),
    });
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

  private async markDocumentFailed(
    documentId: string | null | undefined,
    error: string,
    context?: {
      knowledgeBaseId?: string;
      filename?: string;
      ownerId?: string | null;
      taskId?: string;
      stage?: string;
    },
  ): Promise<void> {
    if (documentId) {
      await this.documentService.updateDocument(documentId, {
        status: 'failed',
        processingStage: 'failed',
        processingError: error,
      });
    }

    await this.createDocumentFailedNotification(documentId ?? null, error, context);
  }

  private async createDocumentFailedNotification(
    documentId: string | null,
    error: string,
    context?: {
      knowledgeBaseId?: string;
      filename?: string;
      ownerId?: string | null;
      taskId?: string;
      stage?: string;
    },
  ): Promise<void> {
    if (!this.notificationService) return;
    try {
      await this.notificationService.create({
        ownerId: context?.ownerId ?? null,
        type: 'document_failed',
        title: '文档处理失败',
        message: `${context?.filename ?? '文档'} 处理失败`,
        payload: {
          knowledgeId: context?.knowledgeBaseId,
          documentId,
          taskId: context?.taskId,
          stage: context?.stage,
          filename: context?.filename,
          error,
        },
      });
    } catch (notifyError) {
      this.logger.warn(
        `创建文档失败通知失败：${
          notifyError instanceof Error ? notifyError.message : String(notifyError)
        }`,
      );
    }
  }

  private async markDocumentGraphFailed(
    documentId: string,
    error: string,
  ): Promise<void> {
    await this.documentService.updateDocument(documentId, {
      graphSyncStatus: 'failed',
      graphSyncError: error,
      graphSyncedAt: null,
      processingStage: 'completed',
    });
  }

  private toIngestOptions(
    input: UploadTaskExecutionInput['input'],
  ): IngestKnowledgeDocumentOptions {
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    return {
      category: input.category,
      ownerId: input.ownerId ?? null,
      tags: this.parseTags(input.tags),
      department: input.department ?? null,
      businessCategory: input.businessCategory ?? null,
      visibility: input.visibility,
      expiresAt:
        expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
      versionGroupId: input.versionGroupId ?? null,
      versionNo: input.versionNo,
      isCurrentVersion: input.isCurrentVersion,
      currentIngestRunId: input.currentIngestRunId ?? null,
      parseStrategy: 'multimodal_parser',
      parserVersion: 'multimodal-v1',
    };
  }

  private get markdownReadMaxBytes(): number {
    const raw = Number(
      this.configService.get<string>('DOCUMENT_MARKDOWN_READ_MAX_BYTES'),
    );
    if (Number.isFinite(raw) && raw > 0) return raw;
    return 20 * 1024 * 1024;
  }

  private parseTags(value?: string | string[]): string[] {
    if (!value) return [];
    const items = Array.isArray(value) ? value : value.split(',');
    return Array.from(
      new Set(items.map((item) => item.trim()).filter(Boolean)),
    );
  }
}
