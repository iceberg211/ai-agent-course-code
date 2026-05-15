import {
  DEFAULT_RETRIEVAL_STRATEGY,
  normalizeRetrievalStrategy,
} from '@/agent/retrieval-strategy.utils';

describe('normalizeRetrievalStrategy', () => {
  const originalGraphFlag = process.env.ENABLE_GRAPH_RETRIEVAL;

  afterEach(() => {
    if (originalGraphFlag === undefined) {
      delete process.env.ENABLE_GRAPH_RETRIEVAL;
    } else {
      process.env.ENABLE_GRAPH_RETRIEVAL = originalGraphFlag;
    }
  });

  it('默认关闭 chunk 上下文窗口，并把显式窗口限制在可控范围内', () => {
    expect(DEFAULT_RETRIEVAL_STRATEGY.chunkContextWindow).toBe(0);
    expect(DEFAULT_RETRIEVAL_STRATEGY.parentContext).toBe(false);

    expect(
      normalizeRetrievalStrategy({
        chunkContextWindow: 9,
      }).chunkContextWindow,
    ).toBe(2);
    expect(
      normalizeRetrievalStrategy({
        chunkContextWindow: -1,
      }).chunkContextWindow,
    ).toBe(0);
    expect(
      normalizeRetrievalStrategy({
        parentContext: true,
        parentContextMaxChars: 99999,
      }),
    ).toMatchObject({
      parentContext: true,
      parentContextMaxChars: 4000,
    });
  });

  it('当前没有 GraphRetriever 时，不把 graph-only 策略当作可执行检索', () => {
    delete process.env.ENABLE_GRAPH_RETRIEVAL;

    const strategy = normalizeRetrievalStrategy({
      needRetrieval: true,
      useVector: false,
      useKeyword: false,
      useGraph: true,
      useExactPhrase: false,
      useMultiQuery: false,
      useHyDE: false,
      allowWeb: false,
      reason: '仅请求图谱检索',
    });

    expect(strategy.useGraph).toBe(false);
    expect(strategy.needRetrieval).toBe(false);
  });

  it('显式开启图谱检索后，graph-only 策略可以进入检索', () => {
    process.env.ENABLE_GRAPH_RETRIEVAL = 'true';

    const strategy = normalizeRetrievalStrategy({
      needRetrieval: true,
      useVector: false,
      useKeyword: false,
      useGraph: true,
      useExactPhrase: false,
      useMultiQuery: false,
      useHyDE: false,
      allowWeb: false,
      reason: '仅请求图谱检索',
    });

    expect(strategy.useGraph).toBe(true);
    expect(strategy.needRetrieval).toBe(true);
  });
});
