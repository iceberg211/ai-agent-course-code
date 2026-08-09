export type QueryWhereBuilder = {
  andWhere: (condition: string, parameters?: Record<string, unknown>) => unknown;
};

export function normalizeStringList(value?: string | string[]): string[] {
  if (!value) return [];
  const items = Array.isArray(value) ? value : value.split(',');
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export function applyJsonbAnyTagFilter(
  qb: QueryWhereBuilder,
  alias: string,
  tags: string[],
): void {
  const normalizedTags = normalizeStringList(tags);
  if (normalizedTags.length === 0) return;

  const clauses = normalizedTags.map((tag, index) => {
    const key = `tagFilter${index}`;
    return {
      clause: `${alias}.tags @> CAST(:${key} AS jsonb)`,
      key,
      value: JSON.stringify([tag]),
    };
  });
  const parameters = Object.fromEntries(
    clauses.map(({ key, value }) => [key, value]),
  );

  qb.andWhere(
    `(${clauses.map(({ clause }) => clause).join(' OR ')})`,
    parameters,
  );
}
