import { buildElasticKeywordShouldClauses } from '@/knowledge-content/keyword-retrievers/elastic-keyword-query.builder';

export function buildRagElasticOnlyQuery(query: string) {
  return {
    bool: {
      should: buildElasticKeywordShouldClauses([query], {
        useExactPhrase: true,
      }),
      minimum_should_match: 1,
    },
  };
}
