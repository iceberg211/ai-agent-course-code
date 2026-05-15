import {
  applyLostInTheMiddleOrdering,
  compressChunkForQuestion,
} from '@/agent/services/answer-context.service';

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
      ['1', '5', '2', '4', '3'],
    );
  });

  it('上下文压缩会优先保留命中问题关键词的句子', () => {
    const content =
      '第一句是很长的背景介绍。第二句说明试用数据删除时限是七日内。第三句讨论付款方式。';

    expect(compressChunkForQuestion(content, '试用数据删除时限')).toContain(
      '试用数据删除时限是七日内',
    );
  });
});
