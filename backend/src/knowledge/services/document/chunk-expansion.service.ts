import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge/entities/knowledge-chunk.entity';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import { MAX_CONTEXT_EXPANSION_WINDOW } from '@/common/constants/knowledge.constants';


interface DocumentWindowRange {
  min: number;
  max: number;
}

@Injectable()
export class ChunkExpansionService {
  constructor(
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
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

  private normalizeWindow(value: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(MAX_CONTEXT_EXPANSION_WINDOW, Math.max(0, Math.floor(parsed)));
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
