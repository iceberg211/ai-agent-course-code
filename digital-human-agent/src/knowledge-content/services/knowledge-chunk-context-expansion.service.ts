import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, Repository } from 'typeorm';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge-content/entities/knowledge-chunk.entity';
import { DEFAULT_PARENT_CHILD_INDEX_VERSION } from '@/knowledge-content/parent-child/knowledge-parent-child-plan';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

interface DocumentWindowRange {
  min: number;
  max: number;
}

interface IndexedParentContextRow {
  hit_chunk_id: string;
  parent_key: string;
  content: string;
  source: string;
  category: string | null;
  start_chunk_index: number;
  end_chunk_index: number;
  child_chunk_ids: string[];
}

@Injectable()
export class KnowledgeChunkContextExpansionService {
  constructor(
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
    @Optional()
    private readonly dataSource?: DataSource,
  ) {}

  async expand(
    chunks: KnowledgeChunk[],
    requestedWindow: number,
  ): Promise<KnowledgeChunk[]> {
    const window = this.normalizeWindow(requestedWindow);
    if (window === 0 || chunks.length === 0) {
      return chunks;
    }

    const ranges = this.buildDocumentRanges(chunks, window);
    if (ranges.size === 0) {
      return chunks;
    }

    const rows = await this.chunkRepo.find({
      where: Array.from(ranges.entries()).map(([documentId, range]) => ({
        documentId,
        enabled: true,
        chunkIndex: Between(range.min, range.max),
      })),
      order: {
        documentId: 'ASC',
        chunkIndex: 'ASC',
      },
    });

    return this.mergeContextRows(chunks, rows, window);
  }

  async expandParentContext(
    chunks: KnowledgeChunk[],
    requestedMaxChars: number,
  ): Promise<KnowledgeChunk[]> {
    const maxChars = this.normalizeParentMaxChars(requestedMaxChars);
    if (chunks.length === 0) {
      return chunks;
    }

    const expandableChunks = chunks.filter(
      (chunk): chunk is KnowledgeChunk & { document_id: string } =>
        this.isExpandableChunk(chunk),
    );
    const indexedParentContexts = await this.findIndexedParentContexts(
      expandableChunks,
      maxChars,
    );
    if (
      indexedParentContexts.size > 0 &&
      indexedParentContexts.size === expandableChunks.length
    ) {
      return chunks.map((chunk) => {
        const row = indexedParentContexts.get(chunk.id);
        return row ? this.toIndexedParentContextChunk(chunk, row) : chunk;
      });
    }

    const documentIds = Array.from(
      new Set(
        expandableChunks.map((chunk) => chunk.document_id),
      ),
    );
    if (documentIds.length === 0) {
      return chunks;
    }

    const rows = await this.chunkRepo.find({
      where: {
        documentId: In(documentIds),
        enabled: true,
      },
      order: {
        documentId: 'ASC',
        chunkIndex: 'ASC',
      },
    });

    return this.mergeParentContextRows(chunks, rows, maxChars);
  }

  private async findIndexedParentContexts(
    chunks: Array<KnowledgeChunk & { document_id: string }>,
    maxChars: number,
  ): Promise<Map<string, IndexedParentContextRow>> {
    if (!this.dataSource || chunks.length === 0) {
      return new Map();
    }

    const chunkIds = Array.from(new Set(chunks.map((chunk) => chunk.id)));
    try {
      const rows = (await this.dataSource.query(
        `
          SELECT
            matched.chunk_id::text AS hit_chunk_id,
            parent.parent_key,
            parent.content,
            parent.source,
            parent.category,
            parent.start_chunk_index,
            parent.end_chunk_index,
            ARRAY(
              SELECT child.chunk_id::text
              FROM rag_parent_chunk_child child
              WHERE child.parent_id = parent.id
              ORDER BY child.position ASC
            ) AS child_chunk_ids
          FROM rag_parent_chunk_child matched
          INNER JOIN rag_parent_chunk parent
            ON parent.id = matched.parent_id
          INNER JOIN rag_parent_chunk_index_status status
            ON status.document_id = parent.document_id
          WHERE matched.chunk_id = ANY($1::uuid[])
            AND parent.index_version = $2
            AND status.index_version = $2
            AND status.status = 'indexed'
            AND parent.char_count <= $3
        `,
        [chunkIds, currentParentChildIndexVersion(), maxChars],
      )) as IndexedParentContextRow[];

      return new Map(rows.map((row) => [row.hit_chunk_id, row]));
    } catch {
      return new Map();
    }
  }

  private normalizeWindow(value: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(2, Math.max(0, Math.floor(parsed)));
  }

  private normalizeParentMaxChars(value: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 2000;
    return Math.min(4000, Math.max(500, Math.floor(parsed)));
  }

  private buildDocumentRanges(
    chunks: KnowledgeChunk[],
    window: number,
  ): Map<string, DocumentWindowRange> {
    const ranges = new Map<string, DocumentWindowRange>();

    for (const chunk of chunks) {
      if (!this.isExpandableChunk(chunk)) continue;

      const documentId = chunk.document_id;
      const min = Math.max(0, chunk.chunk_index - window);
      const max = chunk.chunk_index + window;
      const current = ranges.get(documentId);
      ranges.set(
        documentId,
        current
          ? {
              min: Math.min(current.min, min),
              max: Math.max(current.max, max),
            }
          : { min, max },
      );
    }

    return ranges;
  }

  private mergeContextRows(
    chunks: KnowledgeChunk[],
    rows: KnowledgeChunkEntity[],
    window: number,
  ): KnowledgeChunk[] {
    const originalById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const rowByPosition = new Map<string, KnowledgeChunkEntity>();
    for (const row of rows) {
      rowByPosition.set(this.positionKey(row.documentId, row.chunkIndex), row);
    }

    const expanded: KnowledgeChunk[] = [];
    const seen = new Set<string>();

    const pushChunk = (chunk: KnowledgeChunk) => {
      if (seen.has(chunk.id)) return;
      seen.add(chunk.id);
      expanded.push(chunk);
    };

    for (const chunk of chunks) {
      if (!this.isExpandableChunk(chunk)) {
        pushChunk(chunk);
        continue;
      }

      for (
        let chunkIndex = Math.max(0, chunk.chunk_index - window);
        chunkIndex <= chunk.chunk_index + window;
        chunkIndex += 1
      ) {
        const row = rowByPosition.get(
          this.positionKey(chunk.document_id, chunkIndex),
        );
        if (!row) {
          if (chunkIndex === chunk.chunk_index) {
            pushChunk(chunk);
          }
          continue;
        }

        pushChunk(originalById.get(row.id) ?? this.toRetrievedChunk(row));
      }
    }

    return expanded;
  }

  private mergeParentContextRows(
    chunks: KnowledgeChunk[],
    rows: KnowledgeChunkEntity[],
    maxChars: number,
  ): KnowledgeChunk[] {
    const rowsByDocumentId = new Map<string, KnowledgeChunkEntity[]>();
    for (const row of rows) {
      const current = rowsByDocumentId.get(row.documentId) ?? [];
      current.push(row);
      rowsByDocumentId.set(row.documentId, current);
    }

    return chunks.map((chunk) => {
      if (!this.isExpandableChunk(chunk)) {
        return chunk;
      }

      const documentRows = rowsByDocumentId.get(chunk.document_id) ?? [];
      if (documentRows.length === 0) {
        return chunk;
      }

      const centerIndex = documentRows.findIndex(
        (row) => row.chunkIndex === chunk.chunk_index,
      );
      if (centerIndex < 0) {
        return chunk;
      }

      const selectedRows = this.selectParentRows(
        documentRows,
        centerIndex,
        chunk,
        maxChars,
      );
      if (selectedRows.length <= 1) {
        return chunk;
      }

      return {
        ...chunk,
        content: selectedRows
          .map((row) =>
            row.id === chunk.id ? chunk.content : row.content,
          )
          .join('\n\n'),
        parent_context: true,
        parent_context_child_ids: selectedRows.map((row) => row.id),
      };
    });
  }

  private toIndexedParentContextChunk(
    chunk: KnowledgeChunk,
    row: IndexedParentContextRow,
  ): KnowledgeChunk {
    return {
      ...chunk,
      content: row.content,
      source: row.source || chunk.source,
      category: row.category ?? chunk.category,
      parent_context: true,
      parent_context_indexed: true,
      parent_context_key: row.parent_key,
      parent_context_child_ids: normalizeStringArray(row.child_chunk_ids),
    };
  }

  private selectParentRows(
    rows: KnowledgeChunkEntity[],
    centerIndex: number,
    hit: KnowledgeChunk,
    maxChars: number,
  ): KnowledgeChunkEntity[] {
    const selected = new Map<number, KnowledgeChunkEntity>();
    selected.set(centerIndex, rows[centerIndex]);
    let totalLength = hit.content.length;

    for (let offset = 1; offset < rows.length; offset += 1) {
      let changed = false;
      const leftIndex = centerIndex - offset;
      const rightIndex = centerIndex + offset;

      if (leftIndex >= 0) {
        const left = rows[leftIndex];
        if (totalLength + left.content.length <= maxChars) {
          selected.set(leftIndex, left);
          totalLength += left.content.length;
          changed = true;
        }
      }

      if (rightIndex < rows.length) {
        const right = rows[rightIndex];
        if (totalLength + right.content.length <= maxChars) {
          selected.set(rightIndex, right);
          totalLength += right.content.length;
          changed = true;
        }
      }

      if (!changed && leftIndex < 0 && rightIndex >= rows.length) {
        break;
      }
    }

    return Array.from(selected.entries())
      .sort(([left], [right]) => left - right)
      .map(([, row]) => row);
  }

  private toRetrievedChunk(row: KnowledgeChunkEntity): KnowledgeChunk {
    return {
      id: row.id,
      document_id: row.documentId,
      content: row.content,
      source: row.source,
      chunk_index: row.chunkIndex,
      category: row.category,
      similarity: 0,
      context_expanded: true,
    };
  }

  private isExpandableChunk(
    chunk: KnowledgeChunk,
  ): chunk is KnowledgeChunk & { document_id: string } {
    return (
      typeof chunk.document_id === 'string' &&
      chunk.document_id.length > 0 &&
      Number.isFinite(chunk.chunk_index)
    );
  }

  private positionKey(documentId: string, chunkIndex: number): string {
    return `${documentId}:${chunkIndex}`;
  }
}

function currentParentChildIndexVersion(): string {
  return (
    process.env.PARENT_CHILD_INDEX_VERSION?.trim() ||
    DEFAULT_PARENT_CHILD_INDEX_VERSION
  );
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .replace(/^\{|\}$/g, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
