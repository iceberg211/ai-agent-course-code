export const KNOWLEDGE_INDEX_SETTINGS = {
  index: {
    max_ngram_diff: 4,
  },
  analysis: {
    filter: {
      knowledge_content_ngram_filter: {
        type: 'ngram' as const,
        min_gram: 2,
        max_gram: 6,
        preserve_original: true,
      },
    },
    analyzer: {
      knowledge_content_ik_analyzer: {
        type: 'custom' as const,
        tokenizer: 'ik_max_word',
        filter: ['lowercase'],
      },
      knowledge_content_ik_search_analyzer: {
        type: 'custom' as const,
        tokenizer: 'ik_smart',
        filter: ['lowercase'],
      },
      knowledge_content_ngram_analyzer: {
        type: 'custom' as const,
        tokenizer: 'standard',
        filter: ['lowercase', 'knowledge_content_ngram_filter'],
      },
    },
  },
};

export const KNOWLEDGE_INDEX_MAPPINGS = {
  dynamic: 'strict' as const,
  properties: {
    id: { type: 'keyword' as const },
    document_id: { type: 'keyword' as const },
    knowledge_base_id: { type: 'keyword' as const },
    chunk_index: { type: 'integer' as const },
    enabled: { type: 'boolean' as const },
    content: {
      type: 'text' as const,
      analyzer: 'knowledge_content_ik_analyzer',
      search_analyzer: 'knowledge_content_ik_search_analyzer',
      fields: {
        ngram: {
          type: 'text' as const,
          analyzer: 'knowledge_content_ngram_analyzer',
          search_analyzer: 'standard',
        },
      },
    },
    source: {
      type: 'text' as const,
      fields: {
        keyword: { type: 'keyword' as const, ignore_above: 512 },
      },
    },
    category: {
      type: 'text' as const,
      fields: {
        keyword: { type: 'keyword' as const, ignore_above: 256 },
      },
    },
    source_asset_key: { type: 'keyword' as const, ignore_above: 512 },
    start_ms: { type: 'integer' as const },
    end_ms: { type: 'integer' as const },
    allowed_user_ids: { type: 'keyword' as const },
    allowed_role_ids: { type: 'keyword' as const },
    allowed_department_ids: { type: 'keyword' as const },
    security_level: { type: 'integer' as const },
    acl_version: { type: 'integer' as const },
  },
};
