import { AnswerGenerationService } from '@/agent/services/generation/answer-generation.service';

async function* createStream(parts: string[]) {
  for (const part of parts) {
    yield { content: part };
  }
}

describe('AnswerGenerationService', () => {
  it('会正确流式输出 token 并返回完整答案', async () => {
    const service = new AnswerGenerationService();
    const stream = createStream(['你', '好']);

    Reflect.set(service, 'llm', {
      stream: jest.fn().mockResolvedValue(stream),
    });

    const tokens: string[] = [];
    const output = await service.generate({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      turnId: 'turn-1',
      userMessage: '你好',
      signal: new AbortController().signal,
      persona: {
        id: 'persona-1',
        name: '乔峰',
        description: '豪迈',
        speakingStyle: '直接',
        expertise: ['江湖'],
        voiceId: null,
        avatarId: null,
        systemPromptExtra: null,
      } as never,
      history: [],
      localChunks: [
        {
          id: 'chunk-1',
          content: '乔峰是丐帮帮主。',
          source: 'test.md',
          chunk_index: 0,
          category: null,
          similarity: 0.9,
        },
      ],
      webCitations: [
        {
          kind: 'web',
          title: '雁门关事件资料',
          url: 'https://example.com',
          snippet: '网页摘要',
          siteName: '示例站点',
          publishedAt: '2026-04-21',
        },
      ],
      onToken: (token) => tokens.push(token),
    });

    expect(tokens).toEqual(['你', '好']);
    expect(output).toBe('你好');
  });

  it('会把图谱证据传入最终回答提示词', async () => {
    const service = new AnswerGenerationService();
    const streamMock = jest.fn().mockResolvedValue(createStream(['好']));

    Reflect.set(service, 'llm', {
      stream: streamMock,
    });

    await service.generate({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      turnId: 'turn-1',
      userMessage: '甲方和验收是什么关系？',
      signal: new AbortController().signal,
      persona: {
        id: 'persona-1',
        name: '乔峰',
        description: '豪迈',
        speakingStyle: '直接',
        expertise: ['合同'],
        voiceId: null,
        avatarId: null,
        systemPromptExtra: null,
      } as never,
      history: [],
      localChunks: [
        {
          id: 'chunk-1',
          content: '合同约定甲方在验收后七日内付款。',
          source: 'contracts/service.md',
          chunk_index: 3,
          category: 'contract',
          similarity: 0.82,
          graph_evidence: [
            {
              source: '甲方',
              target: '验收',
              relationType: 'MENTIONS',
              relationLabel: '提及',
              evidenceText: '甲方应在验收后七日内完成付款。',
              confidence: 0.91,
            },
          ],
          retrieval_sources: ['graph'],
        },
      ],
      onToken: jest.fn(),
    });

    const messages = streamMock.mock.calls[0][0] as Array<{ content: string }>;
    expect(messages[0].content).toContain('图谱证据：');
    expect(messages[0].content).toContain('甲方 --提及--> 验收');
  });

  it('会把证据不足评估传入最终回答提示词', async () => {
    const service = new AnswerGenerationService();
    const streamMock = jest.fn().mockResolvedValue(createStream(['好']));

    Reflect.set(service, 'llm', {
      stream: streamMock,
    });

    await service.generate({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      turnId: 'turn-1',
      userMessage: '合同是否允许公开训练？',
      signal: new AbortController().signal,
      persona: {
        id: 'persona-1',
        name: '法务顾问',
        description: '审慎',
        speakingStyle: '先说结论',
        expertise: ['合同'],
        voiceId: null,
        avatarId: null,
        systemPromptExtra: null,
      } as never,
      history: [],
      localChunks: [],
      evidenceAssessment: {
        enough: false,
        missingFacts: ['缺少公开训练条款原文'],
        evaluationReason: '当前证据没有覆盖训练用途限制',
        stopReason: 'single_hop_insufficient',
      },
      onToken: jest.fn(),
    });

    const messages = streamMock.mock.calls[0][0] as Array<{ content: string }>;
    expect(messages[0].content).toContain('证据评估：当前证据不足');
    expect(messages[0].content).toContain('缺少公开训练条款原文');
    expect(messages[0].content).toContain('不要给确定性结论');
  });

  it('generateDirect 会使用轻量闲聊提示词并流式输出', async () => {
    const service = new AnswerGenerationService();
    const streamMock = jest.fn().mockResolvedValue(createStream(['你', '好']));

    Reflect.set(service, 'llm', {
      stream: streamMock,
    });

    const tokens: string[] = [];
    const output = await service.generateDirect({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      turnId: 'turn-1',
      userMessage: '你好',
      signal: new AbortController().signal,
      onToken: (token) => tokens.push(token),
    });

    const messages = streamMock.mock.calls[0][0] as Array<{ content: string }>;
    expect(messages[0].content).toContain('无需知识库检索');
    expect(messages[0].content).toContain('不要提到知识库');
    expect(messages[messages.length - 1].content).toBe('你好');
    expect(tokens).toEqual(['你', '好']);
    expect(output).toBe('你好');
  });
});
