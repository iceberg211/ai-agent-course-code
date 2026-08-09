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

    // 按 documentId 批量鉴权，避免每个 chunk 一次 ACL 查询（N+1）
    const documentAccess = new Map<string, boolean>();
    const uniqueDocuments = new Map<
      string,
      {
        documentId: string;
        visibility: 'private' | 'department' | 'company' | null | undefined;
        ownerId: string | null | undefined;
        department: string | null | undefined;
      }
    >();
    for (const row of rows) {
      if (!row.documentId || uniqueDocuments.has(row.documentId)) continue;
      uniqueDocuments.set(row.documentId, {
        documentId: row.documentId,
        visibility: row.document?.visibility,
        ownerId: row.document?.ownerId,
        department: row.document?.department,
      });
    }

    await Promise.all(
      Array.from(uniqueDocuments.values()).map(async (doc) => {
        const allowed = await this.authorizationService.canAccessDocument(
          {
            id: accessScope?.ownerId ?? undefined,
            role: accessScope?.role ?? undefined,
            department: accessScope?.department ?? undefined,
          },
          {
            documentId: doc.documentId,
            action: 'read',
            visibility: doc.visibility,
            ownerId: doc.ownerId,
            department: doc.department,
          },
        );
        documentAccess.set(doc.documentId, allowed);
      }),
    );

    const allowedChunks: KnowledgeChunk[] = [];
    for (const chunk of chunks) {
      const row = rowById.get(chunk.id);
      if (!row?.documentId) continue;
      if (documentAccess.get(row.documentId) === true) {
        allowedChunks.push(chunk);
      }
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
