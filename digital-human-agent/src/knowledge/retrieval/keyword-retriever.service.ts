import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { KnowledgeChunk as KnowledgeChunkEntity } from './domain/knowledge-chunk.entity';
import { KnowledgeDocument } from './domain/knowledge-document.entity';
import type { KnowledgeChunk } from './domain/retrieval.types';

interface KeywordCandidateRow {
  id: string;
  content: string;
  source: string;
  chunk_index: number;
  category: string | null;
  knowledge_base_id: string;
  document_id: string;
}

@Injectable()
export class KeywordRetrieverService {
  constructor(
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
  ) {}

  async retrieve(
    kbId: string,
    query: string,
    topK: number,
  ): Promise<KnowledgeChunk[]> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery || topK <= 0) return [];

    const terms = this.extractTerms(normalizedQuery);
    const patterns = Array.from(
      new Set([normalizedQuery, ...terms].filter(Boolean)),
    ).slice(0, 12);
    const qb = this.chunkRepo
      .createQueryBuilder('c')
      .innerJoin(KnowledgeDocument, 'd', 'd.id = c.document_id')
      .select('c.id', 'id')
      .addSelect('c.content', 'content')
      .addSelect('c.source', 'source')
      .addSelect('c.chunk_index', 'chunk_index')
      .addSelect('c.category', 'category')
      .addSelect('d.knowledge_base_id', 'knowledge_base_id')
      .addSelect('c.document_id', 'document_id')
      .where('d.knowledge_base_id = :kbId', { kbId })
      .andWhere('c.enabled = true');

    if (patterns.length > 0) {
      qb.andWhere(
        new Brackets((where) => {
          patterns.forEach((pattern, index) => {
            const key = `pattern_${index}`;
            qb.setParameter(key, `%${pattern}%`);
            where.orWhere(`LOWER(c.source) LIKE :${key}`);
            where.orWhere(`LOWER(c.content) LIKE :${key}`);
          });
        }),
      );
    }

    const rows = await qb.getRawMany<KeywordCandidateRow>();

    return rows
      .map((row) => ({
        ...row,
        bm25_score: this.scoreRow(row, normalizedQuery, patterns),
      }))
      .filter((row) => (row.bm25_score ?? 0) > 0)
      .sort((a, b) => {
        const scoreDiff = (b.bm25_score ?? 0) - (a.bm25_score ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        return a.chunk_index - b.chunk_index;
      })
      .slice(0, topK)
      .map((row, index) => ({
        ...row,
        sources: ['keyword'],
        original_ranks: { keyword: index + 1 },
      }));
  }

  private extractTerms(query: string): string[] {
    const tokens = new Set<string>();
    const latinTokens = query.match(/[a-z0-9][a-z0-9_.:-]{1,}/g) ?? [];
    const cjkGroups = query.match(/[\u4e00-\u9fff]{2,}/g) ?? [];

    for (const token of latinTokens) {
      tokens.add(token);
    }

    for (const group of cjkGroups) {
      tokens.add(group);
      if (group.length > 2) {
        for (let i = 0; i < group.length - 1; i += 1) {
          tokens.add(group.slice(i, i + 2));
        }
      }
    }

    return Array.from(tokens)
      .filter((token) => token.trim().length >= 2)
      .sort((a, b) => b.length - a.length);
  }

  private scoreRow(
    row: KeywordCandidateRow,
    normalizedQuery: string,
    terms: string[],
  ): number {
    const source = row.source.toLowerCase();
    const content = row.content.toLowerCase();

    let score = 0;
    if (source.includes(normalizedQuery)) score += 8;
    if (content.includes(normalizedQuery)) score += 6;

    let matchedTerms = 0;
    for (const term of terms) {
      const termWeight = this.termWeight(term);
      const sourceHit = source.includes(term);
      const occurrences = this.countOccurrences(content, term);
      if (!sourceHit && occurrences === 0) continue;

      matchedTerms += 1;
      if (sourceHit) score += termWeight * 2;
      if (occurrences > 0) {
        score += termWeight * Math.min(occurrences, 3);
      }
    }

    if (terms.length > 0) {
      score += (matchedTerms / terms.length) * 5;
    }

    return Number(score.toFixed(4));
  }

  private termWeight(term: string): number {
    if (/^[a-z0-9_.:-]+$/i.test(term)) {
      return term.length >= 6 ? 2.5 : 1.8;
    }
    return term.length >= 4 ? 2.2 : 1.4;
  }

  private countOccurrences(content: string, token: string): number {
    if (!token) return 0;
    let count = 0;
    let offset = 0;
    while (offset < content.length) {
      const index = content.indexOf(token, offset);
      if (index < 0) break;
      count += 1;
      offset = index + token.length;
      if (count >= 3) break;
    }
    return count;
  }
}
