import {
  applyJsonbAnyTagFilter,
  normalizeStringList,
} from '@/knowledge/utils/document-filter.util';

describe('document-filter.util', () => {
  it('normalizeStringList 会清理空值并去重', () => {
    expect(normalizeStringList(' policy, finance,policy, ')).toEqual([
      'policy',
      'finance',
    ]);
  });

  it('applyJsonbAnyTagFilter 会按任一标签生成 jsonb 包含查询', () => {
    const qb = {
      andWhere: jest.fn(),
    };

    applyJsonbAnyTagFilter(qb, 'document', ['policy', 'finance']);

    expect(qb.andWhere).toHaveBeenCalledWith(
      '(document.tags @> CAST(:tagFilter0 AS jsonb) OR document.tags @> CAST(:tagFilter1 AS jsonb))',
      {
        tagFilter0: '["policy"]',
        tagFilter1: '["finance"]',
      },
    );
  });
});
