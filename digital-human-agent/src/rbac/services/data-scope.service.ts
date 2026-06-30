import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge/entities/knowledge-chunk.entity';
import type {
  KnowledgeAccessScope,
  KnowledgeChunk,
  RetrievalStageTrace,
} from '@/knowledge/types/knowledge-content.types';
import { AuthorizationService } from '@/rbac/services/authorization.service';

@Injectable()
export class DataScopeService {
  constructor(
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async filterKnowledgeChunks(
    chunks: KnowledgeChunk[],
    accessScope?: KnowledgeAccessScope,
  ): Promise<{
    chunks: KnowledgeChunk[];
    trace: RetrievalStageTrace['permissionFilter'];
  }> {
    if (chunks.length === 0 || accessScope?.role === 'admin') {
      return {
        chunks,
        trace: {
          before: chunks.length,
          after: chunks.length,
          filtered: 0,
        },
      };
    }

    const rows = await this.chunkRepo.find({
      where: {
        id: In(chunks.map((chunk) => chunk.id)),
        enabled: true,
        document: {
          isCurrentVersion: true,
          archivedAt: IsNull(),
        },
      },
      relations: { document: true },
    });
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const allowedChunks: KnowledgeChunk[] = [];
    for (const chunk of chunks) {
      const row = rowById.get(chunk.id);
      if (!row?.document) continue;
      const allowed = await this.authorizationService.canAccessDocument(
        {
          id: accessScope?.ownerId ?? undefined,
          role: accessScope?.role ?? undefined,
          department: accessScope?.department ?? undefined,
        },
        {
          documentId: row.documentId,
          action: 'read',
          visibility: row.document.visibility,
          ownerId: row.document.ownerId,
          department: row.document.department,
        },
      );
      if (allowed) allowedChunks.push(chunk);
    }

    return {
      chunks: allowedChunks,
      trace: {
        before: chunks.length,
        after: allowedChunks.length,
        filtered: chunks.length - allowedChunks.length,
      },
    };
  }
}
