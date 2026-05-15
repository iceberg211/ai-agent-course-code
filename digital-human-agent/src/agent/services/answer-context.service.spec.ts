import {
  applyLostInTheMiddleOrdering,
  compressChunkForQuestion,
  prepareLocalChunksForAnswer,
} from '@/agent/services/answer-context.service';
import type { RetrievalStrategy } from '@/agent/types/rag-workflow.types';

describe('answer-context.service', () => {
  it('会把高相关 chunk 排到开头和结尾，减少中间位置损耗', () => {
    const chunks = ['1', '2', '3', '4', '5'].map((id) => ({
      id,
      content: id,
      source: `${id}.md`,
      chunk_index: Number(id),
      category: null,
      similarity: 1,
    }));

    expect(applyLostInTheMiddleOrdering(chunks).map((item) => item.id)).toEqual(
      ['1', '3', '5', '4', '2'],
    );
  });

  it('会把前两条最高相关证据分别放在首尾', () => {
    const chunks = ['1', '2', '3', '4', '5', '6'].map((id) => ({
      id,
      content: id,
      source: `${id}.md`,
      chunk_index: Number(id),
      category: null,
      similarity: 1,
    }));

    const ordered = applyLostInTheMiddleOrdering(chunks).map((item) => item.id);

    expect(ordered.at(0)).toBe('1');
    expect(ordered.at(-1)).toBe('2');
  });

  it('上下文压缩会优先保留命中问题关键词的句子', () => {
    const content =
      '第一句是很长的背景介绍。第二句说明试用数据删除时限是七日内。第三句讨论付款方式。';

    expect(compressChunkForQuestion(content, '试用数据删除时限')).toContain(
      '试用数据删除时限是七日内',
    );
  });

  it('策略关闭时不压缩也不重排，策略开启时才处理上下文', () => {
    const chunks = ['1', '2', '3'].map((id) => ({
      id,
      content:
        id === '1'
          ? '第一句是背景。第二句说明试用数据删除时限是七日内。第三句说明付款方式。'.repeat(
              20,
            )
          : `第 ${id} 条证据`,
      source: `${id}.md`,
      chunk_index: Number(id),
      category: null,
      similarity: 1,
    }));
    const strategy = {
      needRetrieval: true,
      useVector: true,
      useKeyword: true,
      useGraph: false,
      useExactPhrase: false,
      useMultiQuery: true,
      useHyDE: false,
      allowWeb: true,
      contextCompression: false,
      lostInMiddle: false,
      reason: '测试策略',
    } satisfies RetrievalStrategy;

    const unchanged = prepareLocalChunksForAnswer(
      chunks,
      '试用数据删除时限',
      strategy,
    );
    expect(unchanged.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(unchanged[0].content).toBe(chunks[0].content);

    const processed = prepareLocalChunksForAnswer(chunks, '试用数据删除时限', {
      ...strategy,
      contextCompression: true,
      lostInMiddle: true,
    });
    expect(processed.map((item) => item.id)).toEqual(['1', '3', '2']);
    expect(processed[0].content.length).toBeLessThan(chunks[0].content.length);
    expect(processed[0].content).toContain('试用数据删除时限是七日内');
  });
});
