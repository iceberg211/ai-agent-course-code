import { formatElasticsearchError } from '@/knowledge-content/elasticsearch/elasticsearch-error-format';

describe('formatElasticsearchError', () => {
  it('在 Elasticsearch ConnectionError message 为空时仍输出可排障信息', () => {
    const error = {
      name: 'ConnectionError',
      message: '',
      meta: {
        statusCode: 0,
        attempts: 3,
        connection: {
          url: new URL('http://elastic:pw-value@localhost:9200/'),
        },
      },
      cause: {
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED 127.0.0.1:9200',
      },
    };

    expect(formatElasticsearchError(error)).toBe(
      'name=ConnectionError statusCode=0 attempts=3 url=http://localhost:9200/ cause=ECONNREFUSED connect ECONNREFUSED 127.0.0.1:9200',
    );
  });
});
