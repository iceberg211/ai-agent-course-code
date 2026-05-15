import {
  buildRollbackAliasActions,
  buildRollbackAliasRefusalReasons,
  buildSwitchAliasActions,
  buildSwitchAliasRefusalReasons,
  replaceElasticsearchIndexVersion,
  resolveRollbackAliasIndexes,
} from '@/knowledge-content/elasticsearch/elasticsearch-alias-actions';

describe('elasticsearch alias actions', () => {
  it('replaceElasticsearchIndexVersion 只替换最后一个版本段', () => {
    expect(
      replaceElasticsearchIndexVersion(
        'digital-human-knowledge-chunk-v1',
        'v2',
      ),
    ).toBe('digital-human-knowledge-chunk-v2');
  });

  it('replaceElasticsearchIndexVersion 拒绝缺少版本后缀或非法版本参数', () => {
    expect(() =>
      replaceElasticsearchIndexVersion(
        'digital-human-knowledge-chunk',
        'v2',
      ),
    ).toThrow('ES 索引名缺少版本后缀');

    expect(() =>
      replaceElasticsearchIndexVersion(
        'digital-human-knowledge-chunk-v1',
        '2',
      ),
    ).toThrow('ES 索引版本必须形如 v2');
  });

  it('buildSwitchAliasActions 原子移除旧索引并添加新索引 read/write alias', () => {
    expect(
      buildSwitchAliasActions({
        fromIndex: 'digital-human-knowledge-chunk-v1',
        toIndex: 'digital-human-knowledge-chunk-v2',
        readAlias: 'digital-human-knowledge-chunk-read',
        writeAlias: 'digital-human-knowledge-chunk-write',
      }),
    ).toEqual([
      {
        remove: {
          index: 'digital-human-knowledge-chunk-v1',
          alias: 'digital-human-knowledge-chunk-read',
          must_exist: false,
        },
      },
      {
        remove: {
          index: 'digital-human-knowledge-chunk-v1',
          alias: 'digital-human-knowledge-chunk-write',
          must_exist: false,
        },
      },
      {
        add: {
          index: 'digital-human-knowledge-chunk-v2',
          alias: 'digital-human-knowledge-chunk-read',
        },
      },
      {
        add: {
          index: 'digital-human-knowledge-chunk-v2',
          alias: 'digital-human-knowledge-chunk-write',
          is_write_index: true,
        },
      },
    ]);
  });

  it('buildSwitchAliasRefusalReasons 在来源索引与当前 alias 不一致时拒绝切换', () => {
    expect(
      buildSwitchAliasRefusalReasons({
        fromIndex: 'digital-human-knowledge-chunk-v1',
        toIndex: 'digital-human-knowledge-chunk-v2',
        readAlias: 'digital-human-knowledge-chunk-read',
        writeAlias: 'digital-human-knowledge-chunk-write',
        targetExists: true,
        documentCount: 10,
        healthStatus: 'green',
        beforeAliasMap: {
          'digital-human-knowledge-chunk-v0': {
            aliases: {
              'digital-human-knowledge-chunk-read': {},
              'digital-human-knowledge-chunk-write': {},
            },
          },
        },
      }),
    ).toEqual([
      'read alias 必须唯一指向来源索引：digital-human-knowledge-chunk-read current=digital-human-knowledge-chunk-v0 expected=digital-human-knowledge-chunk-v1',
      'write alias 必须唯一指向来源索引：digital-human-knowledge-chunk-write current=digital-human-knowledge-chunk-v0 expected=digital-human-knowledge-chunk-v1',
    ]);
  });

  it('buildSwitchAliasRefusalReasons 在 alias 同时指向多个索引时拒绝切换', () => {
    expect(
      buildSwitchAliasRefusalReasons({
        fromIndex: 'digital-human-knowledge-chunk-v1',
        toIndex: 'digital-human-knowledge-chunk-v2',
        readAlias: 'digital-human-knowledge-chunk-read',
        writeAlias: 'digital-human-knowledge-chunk-write',
        targetExists: true,
        documentCount: 10,
        healthStatus: 'green',
        beforeAliasMap: {
          'digital-human-knowledge-chunk-v1': {
            aliases: {
              'digital-human-knowledge-chunk-read': {},
              'digital-human-knowledge-chunk-write': {},
            },
          },
          'digital-human-knowledge-chunk-v0': {
            aliases: {
              'digital-human-knowledge-chunk-read': {},
              'digital-human-knowledge-chunk-write': {},
            },
          },
        },
      }),
    ).toEqual([
      'read alias 必须唯一指向来源索引：digital-human-knowledge-chunk-read current=digital-human-knowledge-chunk-v1,digital-human-knowledge-chunk-v0 expected=digital-human-knowledge-chunk-v1',
      'write alias 必须唯一指向来源索引：digital-human-knowledge-chunk-write current=digital-human-knowledge-chunk-v1,digital-human-knowledge-chunk-v0 expected=digital-human-knowledge-chunk-v1',
    ]);
  });

  it('buildSwitchAliasRefusalReasons 在来源索引和目标索引相同时拒绝切换', () => {
    expect(
      buildSwitchAliasRefusalReasons({
        fromIndex: 'digital-human-knowledge-chunk-v1',
        toIndex: 'digital-human-knowledge-chunk-v1',
        readAlias: 'digital-human-knowledge-chunk-read',
        writeAlias: 'digital-human-knowledge-chunk-write',
        targetExists: true,
        documentCount: 10,
        healthStatus: 'green',
        beforeAliasMap: {
          'digital-human-knowledge-chunk-v1': {
            aliases: {
              'digital-human-knowledge-chunk-read': {},
              'digital-human-knowledge-chunk-write': { is_write_index: true },
            },
          },
        },
      }),
    ).toEqual([
      '来源索引和目标索引不能相同：digital-human-knowledge-chunk-v1',
    ]);
  });

  it('buildSwitchAliasRefusalReasons 在 write alias 未标记为写入索引时拒绝切换', () => {
    expect(
      buildSwitchAliasRefusalReasons({
        fromIndex: 'digital-human-knowledge-chunk-v1',
        toIndex: 'digital-human-knowledge-chunk-v2',
        readAlias: 'digital-human-knowledge-chunk-read',
        writeAlias: 'digital-human-knowledge-chunk-write',
        targetExists: true,
        documentCount: 10,
        healthStatus: 'green',
        beforeAliasMap: {
          'digital-human-knowledge-chunk-v1': {
            aliases: {
              'digital-human-knowledge-chunk-read': {},
              'digital-human-knowledge-chunk-write': {},
            },
          },
        },
      }),
    ).toEqual([
      'write alias 未标记为写入索引：digital-human-knowledge-chunk-write index=digital-human-knowledge-chunk-v1',
    ]);
  });

  it('buildRollbackAliasActions 移除所有当前 alias 索引后指向目标索引', () => {
    expect(
      buildRollbackAliasActions({
        currentAliasIndexes: [
          'digital-human-knowledge-chunk-v1',
          'digital-human-knowledge-chunk-v2',
        ],
        targetIndex: 'digital-human-knowledge-chunk-v1',
        readAlias: 'digital-human-knowledge-chunk-read',
        writeAlias: 'digital-human-knowledge-chunk-write',
      }),
    ).toEqual([
      {
        remove: {
          index: 'digital-human-knowledge-chunk-v1',
          alias: 'digital-human-knowledge-chunk-read',
          must_exist: false,
        },
      },
      {
        remove: {
          index: 'digital-human-knowledge-chunk-v1',
          alias: 'digital-human-knowledge-chunk-write',
          must_exist: false,
        },
      },
      {
        remove: {
          index: 'digital-human-knowledge-chunk-v2',
          alias: 'digital-human-knowledge-chunk-read',
          must_exist: false,
        },
      },
      {
        remove: {
          index: 'digital-human-knowledge-chunk-v2',
          alias: 'digital-human-knowledge-chunk-write',
          must_exist: false,
        },
      },
      {
        add: {
          index: 'digital-human-knowledge-chunk-v1',
          alias: 'digital-human-knowledge-chunk-read',
        },
      },
      {
        add: {
          index: 'digital-human-knowledge-chunk-v1',
          alias: 'digital-human-knowledge-chunk-write',
          is_write_index: true,
        },
      },
    ]);
  });

  it('buildRollbackAliasRefusalReasons 在目标回滚索引不存在时给出拒绝原因', () => {
    expect(
      buildRollbackAliasRefusalReasons({
        targetIndex: 'digital-human-knowledge-chunk-v0',
        targetExists: false,
      }),
    ).toEqual(['目标回滚索引不存在：digital-human-knowledge-chunk-v0']);
  });

  it('resolveRollbackAliasIndexes 支持可选来源版本用于回滚审计', () => {
    expect(
      resolveRollbackAliasIndexes({
        currentIndex: 'digital-human-knowledge-chunk-v2',
        fromVersion: 'v2',
        toVersion: 'v1',
      }),
    ).toEqual({
      fromIndex: 'digital-human-knowledge-chunk-v2',
      targetIndex: 'digital-human-knowledge-chunk-v1',
    });
  });

  it('resolveRollbackAliasIndexes 未传来源版本时保持旧回滚命令兼容', () => {
    expect(
      resolveRollbackAliasIndexes({
        currentIndex: 'digital-human-knowledge-chunk-v2',
        fromVersion: null,
        toVersion: 'v1',
      }),
    ).toEqual({
      fromIndex: null,
      targetIndex: 'digital-human-knowledge-chunk-v1',
    });
  });
});
