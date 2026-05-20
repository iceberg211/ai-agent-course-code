export interface KnowledgeChunkIndexDocument {
  id: string;
  document_id: string;
  knowledge_base_id: string;
  chunk_index: number;
  content: string;
  source: string;
  category: string | null;
  enabled: boolean;
}

export interface KnowledgeChunkIndexCursor {
  createdAt: string;
  id: string;
}

export interface KnowledgeChunkIndexRow extends KnowledgeChunkIndexDocument {
  created_at: string;
}

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
