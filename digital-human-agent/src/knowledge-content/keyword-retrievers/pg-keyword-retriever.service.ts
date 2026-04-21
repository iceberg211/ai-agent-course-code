import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge-content/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge-content/entities/knowledge-document.entity';
import {
  escapeLike,
  normalizeKeywordTerms,
} from '@/knowledge-content/keyword-retrievers/keyword-retriever.utils';
import type {
  KeywordRetrieveParams,
  KeywordRetriever,
} from '@/knowledge-content/keyword-retrievers/keyword-retriever.interface';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

interface KeywordRow {
  id: string;
  content: string;
  source: string;
  chunk_index: string | number;
  category: string | null;
  knowledge_base_id: string;
  keyword_score: string | number;
}

@Injectable()
export class PgKeywordRetrieverService implements KeywordRetriever {
  constructor(
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
  ) {}

  async retrieveChunks(
    params: KeywordRetrieveParams,
  ): Promise<KnowledgeChunk[]> {
    const normalizedTerms = normalizeKeywordTerms(params.terms);
    if (normalizedTerms.length === 0) {
      return [];
    }

    const parameters: Record<string, string | number> = {
      knowledgeId: params.knowledgeId,
    };
    const scoreClauses: string[] = [];
    const matchClauses: string[] = [];

    normalizedTerms.forEach((term, index) => {
      const likeParam = `term${index}`;
      parameters[likeParam] = `%${escapeLike(term)}%`;

      const baseWeight = Math.min(8, Math.max(2, term.length));
      const contentWeight = baseWeight * 3;
      const sourceWeight = Math.max(2, Math.round(baseWeight * 1.5));
      const categoryWeight = Math.max(1, Math.round(baseWeight * 1.2));

      scoreClauses.push(
        `CASE WHEN chunk.content ILIKE :${likeParam} ESCAPE '\\' THEN ${contentWeight} ELSE 0 END`,
      );
      scoreClauses.push(
        `CASE WHEN chunk.source ILIKE :${likeParam} ESCAPE '\\' THEN ${sourceWeight} ELSE 0 END`,
      );
      scoreClauses.push(
        `CASE WHEN COALESCE(chunk.category, '') ILIKE :${likeParam} ESCAPE '\\' THEN ${categoryWeight} ELSE 0 END`,
      );

      matchClauses.push(
        `chunk.content ILIKE :${likeParam} ESCAPE '\\'`,
        `chunk.source ILIKE :${likeParam} ESCAPE '\\'`,
        `COALESCE(chunk.category, '') ILIKE :${likeParam} ESCAPE '\\'`,
      );
    });

    const scoreSql = `(${scoreClauses.join(' + ')})`;
    const rows = await this.chunkRepo
      .createQueryBuilder('chunk')
      .innerJoin(
        KnowledgeDocument,
        'document',
        'document.id = chunk.document_id',
      )
      .select('chunk.id', 'id')
      .addSelect('chunk.content', 'content')
      .addSelect('chunk.source', 'source')
      .addSelect('chunk.chunk_index', 'chunk_index')
      .addSelect('chunk.category', 'category')
      .addSelect('document.knowledge_base_id', 'knowledge_base_id')
      .addSelect(scoreSql, 'keyword_score')
      .where('document.knowledge_base_id = :knowledgeId', {
        knowledgeId: params.knowledgeId,
      })
      .andWhere('chunk.enabled = true')
      .andWhere(`(${matchClauses.join(' OR ')})`)
      .orderBy('keyword_score', 'DESC')
      .addOrderBy('chunk.chunk_index', 'ASC')
      .limit(params.matchCount)
      .setParameters(parameters)
      .getRawMany<KeywordRow>();

    return rows
      .map((row) => {
        const keywordScore = Number(row.keyword_score);
        if (!Number.isFinite(keywordScore) || keywordScore <= 0) {
          return null;
        }

        return {
          id: row.id,
          content: row.content,
          source: row.source,
          chunk_index: Number(row.chunk_index),
          category: row.category,
          similarity: 0,
          knowledge_base_id: row.knowledge_base_id,
          keyword_score: keywordScore,
          retrieval_sources: ['keyword'],
        } satisfies KnowledgeChunk;
      })
      .filter((chunk) => chunk !== null);
  }
}
