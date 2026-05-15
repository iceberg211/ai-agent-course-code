const FALLBACK_KEYWORD_PUNCTUATION =
  /[，。！？；：、“”‘’（）()【】\[\],.!?;:]/g;
const FALLBACK_KEYWORD_CJK_STOP_PHRASES =
  /(请问|帮我|告诉我|示例|哪些|哪个|什么|如何|怎么|为何|为什么|是否|是不是|有没有|是什么|怎么办|处理|一下)/g;
const FALLBACK_KEYWORD_CJK_BOUNDARIES =
  /[的得地了吗呢啊吧里中上下一后前为与和及或对把将应需可该]/g;
const CJK_CHARACTER = /[\u3400-\u9fff]/;

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

export function escapeLike(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function extractFallbackKeywordTerms(query: string): string[] {
  const trimmedQuery = query.trim();
  const tokens = trimmedQuery
    .replace(FALLBACK_KEYWORD_PUNCTUATION, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  const terms = tokens.flatMap((token) => splitFallbackKeywordToken(token));
  const deduped = Array.from(
    new Set(terms.map((term) => term.trim()).filter((term) => term.length >= 2)),
  ).slice(0, 8);

  return deduped.length > 0 ? deduped : trimmedQuery ? [trimmedQuery] : [];
}

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
