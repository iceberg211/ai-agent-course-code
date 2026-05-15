import {
  splitKnowledgeDocumentContent,
  type RecursiveChunkSplitter,
} from '@/knowledge-content/services/knowledge-document-chunking.service';

describe('splitKnowledgeDocumentContent', () => {
  function createSplitter(): RecursiveChunkSplitter {
    return {
      createDocuments: jest.fn(async (texts: string[]) =>
        texts.flatMap((text) => [
          { pageContent: `${text.slice(0, 20)}-part-1` },
          { pageContent: `${text.slice(20, 40)}-part-2` },
        ]),
      ),
    };
  }

  it('Markdown 文档会按标题边界形成结构化 chunk，不把相邻章节混在一起', async () => {
    const splitter = createSplitter();
    const chunks = await splitKnowledgeDocumentContent(
      [
        '# 服务协议',
        '',
        '总览说明。',
        '',
        '## 试用数据',
        '',
        '试用期结束后，乙方应在七日内删除甲方试用数据。',
        '',
        '## 付款条款',
        '',
        '甲方应在验收后十日内付款。',
      ].join('\n'),
      splitter,
    );

    expect(chunks.map((chunk) => chunk.pageContent)).toEqual([
      '# 服务协议\n\n总览说明。',
      '# 服务协议\n## 试用数据\n\n试用期结束后，乙方应在七日内删除甲方试用数据。',
      '# 服务协议\n## 付款条款\n\n甲方应在验收后十日内付款。',
    ]);
    expect(splitter.createDocuments).not.toHaveBeenCalled();
  });

  it('普通文本仍使用现有递归分块器，避免改变非结构化文档行为', async () => {
    const splitter = createSplitter();
    const chunks = await splitKnowledgeDocumentContent(
      '这是一段没有 Markdown 标题的普通文本，需要保持原有分块行为。',
      splitter,
    );

    expect(splitter.createDocuments).toHaveBeenCalledWith([
      '这是一段没有 Markdown 标题的普通文本，需要保持原有分块行为。',
    ]);
    expect(chunks).toHaveLength(2);
  });

  it('开启语义分块时会用相邻句子 embedding 相似度寻找主题断点', async () => {
    const splitter = createSplitter();
    const embeddings = {
      embedDocuments: jest.fn().mockResolvedValue([
        [1, 0],
        [0.96, 0.04],
        [0, 1],
        [0.04, 0.96],
      ]),
    };
    const chunks = await splitKnowledgeDocumentContent(
      '试用期结束后需要删除数据。乙方七日内完成删除。付款在验收后十日内完成。发票随付款流程开具。',
      splitter,
      {
        semanticChunking: {
          enabled: true,
          embeddings,
          similarityThreshold: 0.8,
        },
      },
    );

    expect(embeddings.embedDocuments).toHaveBeenCalledWith([
      '试用期结束后需要删除数据。',
      '乙方七日内完成删除。',
      '付款在验收后十日内完成。',
      '发票随付款流程开具。',
    ]);
    expect(chunks.map((chunk) => chunk.pageContent)).toEqual([
      '试用期结束后需要删除数据。乙方七日内完成删除。',
      '付款在验收后十日内完成。发票随付款流程开具。',
    ]);
    expect(splitter.createDocuments).not.toHaveBeenCalled();
  });

  it('语义分块失败时会回退到现有递归分块器', async () => {
    const splitter = createSplitter();
    const embeddings = {
      embedDocuments: jest.fn().mockRejectedValue(new Error('embed failed')),
    };
    const chunks = await splitKnowledgeDocumentContent(
      '第一句介绍背景。第二句继续背景。第三句切到新主题。',
      splitter,
      {
        semanticChunking: {
          enabled: true,
          embeddings,
          similarityThreshold: 0.8,
        },
      },
    );

    expect(splitter.createDocuments).toHaveBeenCalledWith([
      '第一句介绍背景。第二句继续背景。第三句切到新主题。',
    ]);
    expect(chunks).toHaveLength(2);
  });

  it('单个结构化章节过长时会回退到现有递归分块器', async () => {
    const splitter = createSplitter();
    const longParagraph = '长期服务条款。'.repeat(200);
    const chunks = await splitKnowledgeDocumentContent(
      ['# 服务协议', '', '## 长条款', '', longParagraph].join('\n'),
      splitter,
    );

    expect(splitter.createDocuments).toHaveBeenCalledWith([
      `# 服务协议\n## 长条款\n\n${longParagraph}`,
    ]);
    expect(chunks).toHaveLength(2);
  });
});
