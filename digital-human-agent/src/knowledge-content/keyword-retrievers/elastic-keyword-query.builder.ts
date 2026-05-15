export interface BuildElasticKeywordShouldClausesOptions {
  useExactPhrase: boolean;
}

export function buildElasticKeywordShouldClauses(
  terms: string[],
  options: BuildElasticKeywordShouldClausesOptions,
) {
  return terms.flatMap((term) =>
    [
      options.useExactPhrase
        ? {
            match_phrase: {
              content: {
                query: term,
                boost: 8,
              },
            },
          }
        : null,
      {
        match: {
          content: {
            query: term,
            boost: 4,
          },
        },
      },
      {
        match: {
          source: {
            query: term,
            boost: 2,
          },
        },
      },
      {
        match: {
          category: {
            query: term,
            boost: 2,
          },
        },
      },
      {
        term: {
          'source.keyword': {
            value: term,
            boost: 3,
          },
        },
      },
      {
        term: {
          'category.keyword': {
            value: term,
            boost: 3,
          },
        },
      },
      {
        match: {
          'content.ngram': {
            query: term,
            boost: 1.2,
          },
        },
      },
    ].filter((query) => query !== null),
  );
}
