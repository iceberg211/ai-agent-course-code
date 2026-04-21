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
