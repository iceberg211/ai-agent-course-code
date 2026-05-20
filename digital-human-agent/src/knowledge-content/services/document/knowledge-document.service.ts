import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge-content/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge-content/entities/knowledge-document.entity';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import { ElasticsearchIndexService } from '@/knowledge-content/elasticsearch/elasticsearch-index.service';
import { KnowledgeGraphService } from '@/knowledge-content/graph/knowledge-graph.service';
import type { IngestKnowledgeDocumentOptions } from '@/knowledge-content/types/knowledge-content.types';

import type {
  KnowledgeDocumentChunk,
  RecursiveChunkSplitter,
  MarkdownHeading,
  MarkdownSection,
  KnowledgeDocumentChunkRow,
} from '@/knowledge-content/types/knowledge-document.types';

const STRUCTURED_CHUNK_MAX_LENGTH = 900;

// ==========================================
// Markdown 文档切片纯函数 (从 chunking.service 迁移)
// ==========================================

export async function splitKnowledgeDocumentContent(
  content: string,
  fallbackSplitter: RecursiveChunkSplitter,
): Promise<KnowledgeDocumentChunk[]> {
  if (!hasMarkdownHeading(content)) {
    return fallbackSplitter.createDocuments([content]);
  }

  const sections = buildMarkdownSections(content)
    .map(formatMarkdownSection)
    .filter((section) => section.length > 0);

  if (sections.length === 0) {
    return fallbackSplitter.createDocuments([content]);
  }

  const chunks: KnowledgeDocumentChunk[] = [];
  for (const section of sections) {
    if (section.length > STRUCTURED_CHUNK_MAX_LENGTH) {
      chunks.push(...(await fallbackSplitter.createDocuments([section])));
    } else {
      chunks.push({ pageContent: section });
    }
  }

  return chunks;
}

function hasMarkdownHeading(content: string): boolean {
  return /^#{1,6}\s+\S+/mu.test(content);
}

function buildMarkdownSections(content: string): MarkdownSection[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const sections: MarkdownSection[] = [];
  const headingStack: MarkdownHeading[] = [];
  let current: MarkdownSection | null = null;
  const preamble: string[] = [];

  const flushCurrent = () => {
    if (!current) return;
    sections.push(current);
    current = null;
  };

  for (const line of lines) {
    const heading = parseHeading(line);
    if (!heading) {
      if (current) {
        current.bodyLines.push(line);
      } else {
        preamble.push(line);
      }
      continue;
    }

    flushCurrent();
    while (
      headingStack.length > 0 &&
      headingStack[headingStack.length - 1].level >= heading.level
    ) {
      headingStack.pop();
    }
    headingStack.push(heading);
    current = {
      headings: [...headingStack],
      bodyLines: [],
    };
  }

  flushCurrent();

  const preambleText = trimEmptyLines(preamble).join('\n').trim();
  if (preambleText) {
    sections.unshift({
      headings: [],
      bodyLines: [preambleText],
    });
  }

  return sections;
}

function parseHeading(line: string): MarkdownHeading | null {
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  if (!match) return null;
  return {
    level: match[1].length,
    line: `${match[1]} ${match[2].trim()}`,
  };
}

function formatMarkdownSection(section: MarkdownSection): string {
  const headingText = section.headings
    .map((heading) => heading.line)
    .join('\n');
  const bodyText = trimEmptyLines(section.bodyLines).join('\n').trim();

  if (!bodyText) return '';
  if (!headingText) return bodyText;
  return `${headingText}\n\n${bodyText}`;
}

function trimEmptyLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end);
}

// ==========================================
// 核心 Service 实现
// ==========================================

@Injectable()
export class KnowledgeDocumentService {
  private readonly logger = new Logger(KnowledgeDocumentService.name);

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepo: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
    private readonly runtime: KnowledgeContentRuntimeService,
    private readonly elasticsearchService: ElasticsearchIndexService,
    private readonly graphService: KnowledgeGraphService,
  ) {}

  // ==========================================
  // 删除文档与索引清理
  // ==========================================
  async deleteDocument(documentId: string): Promise<void> {
    await this.documentRepo.delete(documentId);
    await this.cleanupDocument(documentId, `删除文档 ${documentId}`);
  }

  // ==========================================
  // 文档导入/分片与 Embedding 入库
  // ==========================================
  async ingestDocument(
    knowledgeId: string,
    filename: string,
    content: string,
    options: IngestKnowledgeDocumentOptions = {},
  ): Promise<KnowledgeDocument> {
    const document = await this.documentRepo.save(
      this.documentRepo.create({
        knowledgeBaseId: knowledgeId,
        filename,
        status: 'processing',
        mimeType: options.mimeType ?? null,
        fileSize: options.fileSize ?? null,
      }),
    );

    try {
      const splitDocuments = await splitKnowledgeDocumentContent(
        content,
        this.runtime.splitter,
      );
      this.logger.log(
        `[切分完成] filename=${filename} chunks=${splitDocuments.length}`,
      );

      const texts = splitDocuments.map((item) => item.pageContent);
      this.logger.log(
        `[开始 Embedding] model=${this.runtime.embeddings.model} texts=${texts.length} batchSize=${this.runtime.embeddingBatchSize}`,
      );
      const embeddings = await this.runtime.embeddings.embedDocuments(texts);
      this.logger.log(`[Embedding 完成] dims=${embeddings[0]?.length}`);

      const chunkRows = splitDocuments.map((item, index) => ({
        id: randomUUID(),
        document_id: document.id,
        chunk_index: index,
        content: item.pageContent,
        source: filename,
        category: options.category ?? null,
        enabled: true,
        embedding: JSON.stringify(embeddings[index]),
      })) satisfies KnowledgeDocumentChunkRow[];

      // 1. 写入 Supabase PG 数据库
      await this.insertChunkRows(document.id, chunkRows);

      // 2. 写入 Elasticsearch 索引
      await this.syncDocumentIndex({
        documentId: document.id,
        knowledgeId,
        rows: chunkRows,
      });

      await this.documentRepo.update(document.id, {
        status: 'completed',
        chunkCount: splitDocuments.length,
        graphSyncStatus: 'pending',
        graphSyncError: null,
        graphSyncedAt: null,
      });

      // 3. 后置异步尽力同步 Neo4j 知识图谱
      await this.syncGraphBestEffort({
        documentId: document.id,
        knowledgeId,
        source: filename,
        rows: chunkRows,
      });

      return this.documentRepo.findOneByOrFail({ id: document.id });
    } catch (error) {
      this.logger.error('Ingest failed', error);
      await this.cleanupFailedIngest(document.id);
      await this.documentRepo.update(document.id, {
        status: 'failed',
        chunkCount: 0,
      });
      throw error;
    }
  }

  listDocumentsByKnowledgeId(
    knowledgeId: string,
  ): Promise<KnowledgeDocument[]> {
    return this.documentRepo.find({
      where: { knowledgeBaseId: knowledgeId },
      order: { createdAt: 'DESC' },
    });
  }

  listChunksByDocumentId(documentId: string): Promise<KnowledgeChunkEntity[]> {
    return this.chunkRepo
      .createQueryBuilder('chunk')
      .where('chunk.document_id = :documentId', { documentId })
      .orderBy('chunk.chunk_index', 'ASC')
      .getMany();
  }

  // ==========================================
  // 启用/停用单个 Chunk 并同步索引
  // ==========================================
  async updateChunkEnabled(chunkId: string, enabled: boolean): Promise<void> {
    const context = `更新 chunk ${chunkId}`;
    const { error } = await this.runtime.supabase
      .from('knowledge_chunk')
      .update({ enabled })
      .eq('id', chunkId);

    if (error) {
      throw new Error(error.message);
    }

    await this.syncChunkEnabled(chunkId, enabled, context);
  }

  // ==========================================
  // 内部辅助数据库写入与第三方引擎同步逻辑 (原本在 sync.service)
  // ==========================================
  private async insertChunkRows(
    documentId: string,
    rows: KnowledgeDocumentChunkRow[],
  ): Promise<void> {
    this.logger.log(`[开始 Insert] doc=${documentId} rows=${rows.length}`);

    const batchSize = 50;
    for (let index = 0; index < rows.length; index += batchSize) {
      const batch = rows.slice(index, index + batchSize);
      const result = await this.runtime.withTransientRetry<{
        error: { message: string } | null;
      }>(
        `insert batch ${Math.floor(index / batchSize) + 1}`,
        async () => {
          const response = await this.runtime.supabase
            .from('knowledge_chunk')
            .insert(batch);

          return {
            error: response.error ? { message: response.error.message } : null,
          };
        },
        3,
      );

      if (result.error) {
        throw new Error(result.error.message);
      }
    }

    this.logger.log(
      `[Insert 完成] doc=${documentId} batches=${Math.ceil(rows.length / batchSize)}`,
    );
  }

  private async syncDocumentIndex(input: {
    documentId: string;
    knowledgeId: string;
    rows: KnowledgeDocumentChunkRow[];
  }): Promise<void> {
    await this.elasticsearchService.safeBulkUpsertChunkDocuments(
      input.rows.map((row) => ({
        id: row.id,
        document_id: row.document_id,
        knowledge_base_id: input.knowledgeId,
        chunk_index: row.chunk_index,
        content: row.content,
        source: row.source,
        category: row.category,
        enabled: row.enabled,
      })),
      `写入文档 ${input.documentId}`,
    );
  }

  private async syncChunkEnabled(
    chunkId: string,
    enabled: boolean,
    context: string,
  ): Promise<void> {
    const chunkDocument = await this.elasticsearchService.findByChunkId(chunkId);
    if (chunkDocument) {
      await this.elasticsearchService.safeBulkUpsertChunkDocuments(
        [chunkDocument],
        context,
      );
    }

    await this.graphService.safeUpdateChunkEnabled(
      chunkId,
      enabled,
      context,
    );
  }

  private async syncGraphBestEffort(input: {
    documentId: string;
    knowledgeId: string;
    source: string;
    rows: KnowledgeDocumentChunkRow[];
  }): Promise<void> {
    try {
      const graphSyncResult = await this.syncDocumentGraph({
        documentId: input.documentId,
        knowledgeId: input.knowledgeId,
        source: input.source,
        chunks: input.rows.map((row) => ({
          id: row.id,
          chunkIndex: row.chunk_index,
          source: row.source,
          category: row.category,
          content: row.content,
        })),
      });

      await this.documentRepo.update(input.documentId, {
        graphSyncStatus: graphSyncResult.status,
        graphSyncError:
          graphSyncResult.status === 'failed'
            ? graphSyncResult.errorMessage
            : null,
        graphSyncedAt: graphSyncResult.status === 'indexed' ? new Date() : null,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `图谱后置同步失败（doc=${input.documentId}）：${errorMessage}`,
      );
      await this.documentRepo.update(input.documentId, {
        graphSyncStatus: 'failed',
        graphSyncError: errorMessage,
        graphSyncedAt: null,
      });
    }
  }

  private async syncDocumentGraph(input: {
    documentId: string;
    knowledgeId: string;
    source: string;
    chunks: Array<{
      id: string;
      chunkIndex: number;
      source: string;
      category: string | null;
      content: string;
    }>;
  }) {
    if (!this.graphService.isEnabled()) {
      return { status: 'skipped' as const };
    }

    try {
      const extractedGraph = await this.graphService.extract({
        documentId: input.documentId,
        chunks: input.chunks,
      });

      return await this.graphService.safeUpsertDocument({
        ...input,
        extractedGraph,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `图谱抽取失败（document=${input.documentId}）：${errorMessage}`,
      );
      return { status: 'failed' as const, errorMessage };
    }
  }

  private async cleanupDocument(documentId: string, reason: string): Promise<void> {
    await this.elasticsearchService.safeDeleteByDocumentId(documentId, reason);
    await this.graphService.safeDeleteByDocumentId(documentId, reason);
  }

  private async cleanupFailedIngest(documentId: string): Promise<void> {
    try {
      await this.chunkRepo.delete({ documentId });
    } catch (error) {
      this.logger.warn(
        `导入失败清理 chunk 失败（doc=${documentId}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    await this.cleanupDocument(
      documentId,
      `导入失败清理文档 ${documentId}`,
    );
  }
}
