import { z } from 'zod';
import { extractFallbackKeywordTerms } from '@/knowledge/services/retrieval/retrieval-utils';
import type {
  KnowledgeQueryRewriteResult,
  RetrievalQueryAngle,
  RetrievalQueryItem,
} from '@/knowledge/types/knowledge-content.types';

export const KEYWORD_SPLIT_PATTERN = /[、,，;；\s]+/u;

export const KeywordListSchema = z.union([
  z.array(z.string().min(1).max(50)).min(1).max(6),
  z.string().min(1).max(300),
]);

export const KnowledgeQueryRewriteSchema = z.object({
  rewrittenQuery: z.string().min(1).max(500),
  keywords: KeywordListSchema,
  expandedQueries: z
    .array(
      z.object({
        query: z.string().min(1).max(500),
        keywords: KeywordListSchema,
        angle: z
          .enum(['original', 'entity', 'semantic', 'symptom', 'detail'])
          .default('semantic'),
      }),
    )
    .min(1)
    .max(5)
    .optional(),
  reason: z.string().min(1).max(200),
});

export function normalizeKeywords(keywords: unknown, query: string): string[] {
  const keywordItems = Array.isArray(keywords)
    ? keywords
    : typeof keywords === 'string'
      ? keywords.split(KEYWORD_SPLIT_PATTERN)
      : [];

  const normalized = Array.from(
    new Set(
      keywordItems
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length >= 2),
    ),
  ).slice(0, 6);

  if (normalized.length > 0) {
    return normalized;
  }

  return extractFallbackKeywordTerms(query).slice(0, 6);
}

export function padExpandedQueries(
  items: Array<{
    query: string;
    keywords: string[];
    angle: RetrievalQueryAngle;
  }>,
  rewrittenQuery: string,
  keywords: string[],
  targetCount: number,
): Array<{
  query: string;
  keywords: string[];
  angle: RetrievalQueryAngle;
}> {
  const padded = [...items];
  if (!rewrittenQuery.trim() || padded.length >= targetCount) {
    return padded;
  }

  const seen = new Set(padded.map((item) => item.query.toLowerCase()));
  const normalizedKeywords = normalizeKeywords(keywords, rewrittenQuery);
  const keywordQuery = normalizedKeywords.join(' ').trim();
  const compactKeywords = normalizedKeywords.slice(0, 4).join(' ').trim();
  const headKeywords = normalizedKeywords.slice(0, 2).join(' ').trim();

  const candidates = [
    {
      query: keywordQuery,
      keywords: normalizedKeywords,
      angle: 'entity' as RetrievalQueryAngle,
    },
    {
      query: [rewrittenQuery, compactKeywords].filter(Boolean).join(' '),
      keywords: normalizedKeywords,
      angle: 'semantic' as RetrievalQueryAngle,
    },
    {
      query: [headKeywords, rewrittenQuery].filter(Boolean).join(' '),
      keywords: normalizedKeywords,
      angle: 'detail' as RetrievalQueryAngle,
    },
    {
      query: `${rewrittenQuery} 相关信息`,
      keywords: normalizedKeywords,
      angle: 'semantic' as RetrievalQueryAngle,
    },
    {
      query: `${rewrittenQuery} 具体说明`,
      keywords: normalizedKeywords,
      angle: 'detail' as RetrievalQueryAngle,
    },
  ];

  for (const candidate of candidates) {
    const query = candidate.query.trim();
    if (!query) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    padded.push(candidate);
    if (padded.length >= targetCount) return padded;
  }

  return padded;
}

export function normalizeExpandedQueries(
  expandedQueries: Array<{
    query: string;
    keywords?: unknown;
    angle?: RetrievalQueryAngle;
  }> = [],
  rewrittenQuery: string,
  keywords: string[],
): RetrievalQueryItem[] {
  const seen = new Set<string>();
  const items: Array<{ query: string; keywords?: any; angle?: RetrievalQueryAngle }> = [];

  if (rewrittenQuery.trim()) {
    items.push({
      query: rewrittenQuery,
      keywords,
      angle: 'original' as RetrievalQueryAngle,
    });
  }

  items.push(...expandedQueries);

  const normalizedItems = items
    .map((item) => ({
      query: item.query.trim(),
      keywords: normalizeKeywords(item.keywords ?? [], item.query),
      angle: (item.angle ?? 'semantic') as RetrievalQueryAngle,
    }))
    .filter((item) => {
      if (!item.query) return false;
      const key = item.query.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return padExpandedQueries(
    normalizedItems,
    rewrittenQuery,
    keywords,
    3,
  )
    .slice(0, 3)
    .map((item, index) => ({
      index,
      ...item,
    }));
}

export function resolveRetrievalQueries(
  rewrite: KnowledgeQueryRewriteResult,
  maxQueries: number,
  options: {
    useMultiQuery?: boolean;
    preferOriginal?: boolean;
  } = {},
): RetrievalQueryItem[] {
  const useMultiQuery = options.useMultiQuery ?? true;
  const preferOriginal = options.preferOriginal ?? false;

  const seen = new Set<string>();
  const queries: RetrievalQueryItem[] = [];

  const pushQuery = (
    queryText: string,
    keywords: string[],
    angle: RetrievalQueryItem['angle'],
  ) => {
    const q = queryText.trim();
    if (!q || queries.length >= maxQueries) {
      return;
    }
    const key = q.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    queries.push({
      index: queries.length,
      query: q,
      keywords,
      angle,
    });
  };

  if (!useMultiQuery) {
    // 单路检索模式
    if (preferOriginal && rewrite.originalQuery) {
      pushQuery(
        rewrite.originalQuery,
        normalizeKeywords(rewrite.keywords, rewrite.originalQuery),
        'original',
      );
    } else if (rewrite.rewrittenQuery) {
      pushQuery(
        rewrite.rewrittenQuery,
        normalizeKeywords(rewrite.keywords, rewrite.rewrittenQuery),
        rewrite.rewrittenQuery === rewrite.originalQuery ? 'original' : 'semantic',
      );
    }
  } else {
    // 多路检索模式
    if (preferOriginal) {
      // Agent 模式，首位塞 originalQuery，次位塞 rewrittenQuery
      if (rewrite.originalQuery) {
        pushQuery(
          rewrite.originalQuery,
          normalizeKeywords(rewrite.keywords, rewrite.originalQuery),
          'original',
        );
      }
      if (rewrite.rewrittenQuery) {
        pushQuery(
          rewrite.rewrittenQuery,
          normalizeKeywords(rewrite.keywords, rewrite.rewrittenQuery),
          rewrite.rewrittenQuery === rewrite.originalQuery ? 'original' : 'semantic',
        );
      }
      for (const item of rewrite.expandedQueries ?? []) {
        pushQuery(
          item.query,
          normalizeKeywords(item.keywords ?? [], item.query),
          item.angle ?? 'semantic',
        );
      }
    } else {
      // API 检索模式，若有 expandedQueries 则直用
      if ((rewrite.expandedQueries?.length ?? 0) > 0) {
        for (const item of rewrite.expandedQueries!) {
          pushQuery(
            item.query,
            normalizeKeywords(item.keywords ?? [], item.query),
            item.angle ?? 'semantic',
          );
        }
      } else if (rewrite.rewrittenQuery) {
        pushQuery(
          rewrite.rewrittenQuery,
          normalizeKeywords(rewrite.keywords, rewrite.rewrittenQuery),
          rewrite.rewrittenQuery === rewrite.originalQuery ? 'original' : 'semantic',
        );
      }
    }
  }

  // 兜底保护
  if (queries.length === 0 && rewrite.originalQuery) {
    pushQuery(
      rewrite.originalQuery,
      normalizeKeywords(rewrite.keywords, rewrite.originalQuery),
      'original',
    );
  }

  return queries;
}
