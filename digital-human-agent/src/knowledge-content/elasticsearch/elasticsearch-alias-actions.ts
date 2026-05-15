export interface ElasticsearchAliasNames {
  readAlias: string;
  writeAlias: string;
}

export interface SwitchAliasActionInput extends ElasticsearchAliasNames {
  fromIndex: string;
  toIndex: string;
}

export interface RollbackAliasActionInput extends ElasticsearchAliasNames {
  currentAliasIndexes: string[];
  targetIndex: string;
}

export interface RollbackAliasRefusalInput {
  targetIndex: string;
  targetExists: boolean;
}

export interface RollbackAliasIndexInput {
  currentIndex: string;
  fromVersion?: string | null;
  toVersion: string;
}

export interface RollbackAliasIndexes {
  fromIndex: string | null;
  targetIndex: string;
}

export type ElasticsearchAliasMap = Record<
  string,
  {
    aliases?: Record<string, { is_write_index?: boolean }>;
  }
>;

export interface SwitchAliasRefusalInput extends SwitchAliasActionInput {
  beforeAliasMap: ElasticsearchAliasMap;
  targetExists: boolean;
  documentCount: number | null;
  healthStatus: string | null;
}

export type ElasticsearchAliasAction =
  | {
      remove: {
        index: string;
        alias: string;
        must_exist: false;
      };
    }
  | {
      add: {
        index: string;
        alias: string;
        is_write_index?: true;
      };
    };

export function replaceElasticsearchIndexVersion(
  indexName: string,
  version: string,
): string {
  const normalizedVersion = version.trim();
  if (!/^v\d+$/.test(normalizedVersion)) {
    throw new Error(`ES 索引版本必须形如 v2：${version}`);
  }
  if (!/-v\d+$/.test(indexName)) {
    throw new Error(`ES 索引名缺少版本后缀：${indexName}`);
  }

  return indexName.replace(/-v\d+$/, `-${normalizedVersion}`);
}

export function buildSwitchAliasActions(
  input: SwitchAliasActionInput,
): ElasticsearchAliasAction[] {
  return [
    {
      remove: {
        index: input.fromIndex,
        alias: input.readAlias,
        must_exist: false,
      },
    },
    {
      remove: {
        index: input.fromIndex,
        alias: input.writeAlias,
        must_exist: false,
      },
    },
    {
      add: {
        index: input.toIndex,
        alias: input.readAlias,
      },
    },
    {
      add: {
        index: input.toIndex,
        alias: input.writeAlias,
        is_write_index: true,
      },
    },
  ];
}

function findAliasIndexes(
  aliasMap: ElasticsearchAliasMap,
  aliasName: string,
): string[] {
  return Object.entries(aliasMap)
    .filter(([, value]) => Boolean(value.aliases?.[aliasName]))
    .map(([index]) => index);
}

function formatAliasIndexes(indexes: string[]): string {
  return indexes.length > 0 ? indexes.join(',') : 'none';
}

function isOnlyAliasIndex(indexes: string[], expectedIndex: string): boolean {
  return indexes.length === 1 && indexes[0] === expectedIndex;
}

function isWriteIndexAlias(
  aliasMap: ElasticsearchAliasMap,
  indexName: string,
  aliasName: string,
): boolean {
  return aliasMap[indexName]?.aliases?.[aliasName]?.is_write_index === true;
}

export function buildSwitchAliasRefusalReasons(
  input: SwitchAliasRefusalInput,
): string[] {
  const readAliasIndexes = findAliasIndexes(
    input.beforeAliasMap,
    input.readAlias,
  );
  const writeAliasIndexes = findAliasIndexes(
    input.beforeAliasMap,
    input.writeAlias,
  );

  return [
    input.fromIndex === input.toIndex
      ? `来源索引和目标索引不能相同：${input.fromIndex}`
      : null,
    !input.targetExists ? `目标索引不存在：${input.toIndex}` : null,
    input.targetExists && (input.documentCount ?? 0) <= 0
      ? `目标索引没有文档，拒绝切换：${input.toIndex}`
      : null,
    input.healthStatus === 'red'
      ? `目标索引 health=red，拒绝切换：${input.toIndex}`
      : null,
    !isOnlyAliasIndex(readAliasIndexes, input.fromIndex)
      ? `read alias 必须唯一指向来源索引：${input.readAlias} current=${formatAliasIndexes(
          readAliasIndexes,
        )} expected=${input.fromIndex}`
      : null,
    !isOnlyAliasIndex(writeAliasIndexes, input.fromIndex)
      ? `write alias 必须唯一指向来源索引：${input.writeAlias} current=${formatAliasIndexes(
          writeAliasIndexes,
        )} expected=${input.fromIndex}`
      : null,
    isOnlyAliasIndex(writeAliasIndexes, input.fromIndex) &&
    !isWriteIndexAlias(input.beforeAliasMap, input.fromIndex, input.writeAlias)
      ? `write alias 未标记为写入索引：${input.writeAlias} index=${input.fromIndex}`
      : null,
  ].filter((reason): reason is string => Boolean(reason));
}

export function buildRollbackAliasActions(
  input: RollbackAliasActionInput,
): ElasticsearchAliasAction[] {
  return [
    ...input.currentAliasIndexes.flatMap((index) => [
      {
        remove: {
          index,
          alias: input.readAlias,
          must_exist: false as const,
        },
      },
      {
        remove: {
          index,
          alias: input.writeAlias,
          must_exist: false as const,
        },
      },
    ]),
    {
      add: {
        index: input.targetIndex,
        alias: input.readAlias,
      },
    },
    {
      add: {
        index: input.targetIndex,
        alias: input.writeAlias,
        is_write_index: true,
      },
    },
  ];
}

export function buildRollbackAliasRefusalReasons(
  input: RollbackAliasRefusalInput,
): string[] {
  return [
    !input.targetExists ? `目标回滚索引不存在：${input.targetIndex}` : null,
  ].filter((reason): reason is string => Boolean(reason));
}

export function resolveRollbackAliasIndexes(
  input: RollbackAliasIndexInput,
): RollbackAliasIndexes {
  return {
    fromIndex: input.fromVersion
      ? replaceElasticsearchIndexVersion(input.currentIndex, input.fromVersion)
      : null,
    targetIndex: replaceElasticsearchIndexVersion(
      input.currentIndex,
      input.toVersion,
    ),
  };
}
