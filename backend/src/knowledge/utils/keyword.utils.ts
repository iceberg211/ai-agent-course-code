/**
 * 关键词处理工具函数集。
 *
 * 集中管理 CJK 分词、关键词标准化等逻辑，
 * 供 QueryRewrite / FulltextRetriever / KnowledgeSearch 等多处复用。
 */

// ==========================================
// CJK 正则常量
// ==========================================

const FALLBACK_KEYWORD_PUNCTUATION =
  /[，。！？；：、""''（）()【】\[\],.!?;:]/g;

const FALLBACK_KEYWORD_CJK_STOP_PHRASES =
  /(请问|帮我|告诉我|示例|哪些|哪个|什么|如何|怎么|为何|为什么|是否|是不是|有没有|是什么|怎么办|处理|一下)/g;

const FALLBACK_KEYWORD_CJK_BOUNDARIES =
  /[的得地了吗呢啊吧里中上下一后前为与和及或对把将应需可该]/g;

const CJK_CHARACTER = /[\u3400-\u9fff]/;

/** 关键词字符串拆分模式（支持中英文分隔符） */
export const KEYWORD_SPLIT_PATTERN = /[、,，;；\s]+/u;

// ==========================================
// 关键词标准化
// ==========================================

/**
 * 标准化关键词列表。
 *
 * 接受 LLM 返回的 keywords（可能是 string[] 或逗号分隔的 string），
 * 去重、过滤过短词、截断为最多 6 个关键词。
 * 如果结果为空，自动 fallback 到 `extractFallbackKeywordTerms`。
 */
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

/**
 * 标准化检索关键词列表（去重、过滤短词、按长度降序、截断为 8 个）。
 */
export function normalizeKeywordTerms(terms: string[]): string[] {
  return Array.from(
    new Set(
      terms
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
        .sort((left, right) => right.length - left.length),
    ),
  ).slice(0, 8);
}

// ==========================================
// Fallback 关键词提取（基于 CJK 分词）
// ==========================================

/**
 * 从原始 query 中提取 fallback 关键词。
 *
 * 当 LLM 关键词改写失败或返回空时使用，基于正则的简易 CJK 分词。
 */
export function extractFallbackKeywordTerms(query: string): string[] {
  const trimmedQuery = query.trim();
  const tokens = trimmedQuery
    .replace(FALLBACK_KEYWORD_PUNCTUATION, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  const terms = tokens.flatMap((token) => splitFallbackKeywordToken(token));
  const deduped = Array.from(
    new Set(
      terms.map((term) => term.trim()).filter((term) => term.length >= 2),
    ),
  ).slice(0, 8);

  return deduped.length > 0 ? deduped : trimmedQuery ? [trimmedQuery] : [];
}

// ==========================================
// SQL LIKE 转义
// ==========================================

/** 转义 SQL LIKE 查询中的特殊字符 */
export function escapeLike(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ==========================================
// 内部 CJK 分词辅助函数
// ==========================================

function splitFallbackKeywordToken(token: string): string[] {
  if (!CJK_CHARACTER.test(token)) return [token];
  if (token.length <= 8) return [token];

  const parts = token
    .replace(FALLBACK_KEYWORD_CJK_STOP_PHRASES, ' ')
    .replace(FALLBACK_KEYWORD_CJK_BOUNDARIES, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);

  const terms = parts.flatMap((part) =>
    part.length <= 8 ? [part] : splitLongCjkTerm(part),
  );

  return terms.length > 0 ? terms : [token.slice(0, 8)];
}

function splitLongCjkTerm(term: string): string[] {
  const terms: string[] = [];
  for (const size of [6, 5, 4, 3, 2]) {
    for (let index = 0; index + size <= term.length; index += 1) {
      const candidate = term.slice(index, index + size);
      if (!CJK_CHARACTER.test(candidate) || terms.includes(candidate)) continue;
      terms.push(candidate);
      if (terms.length >= 6) return terms;
    }
  }

  return terms;
}
