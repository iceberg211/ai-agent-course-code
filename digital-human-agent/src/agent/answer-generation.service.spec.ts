import { AnswerGenerationService } from '@/agent/answer-generation.service';

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
      chunks: [
        {
          id: 'chunk-1',
          content: '乔峰是丐帮帮主。',
          source: 'test.md',
          chunk_index: 0,
          category: null,
          similarity: 0.9,
        },
      ],
      onToken: (token) => tokens.push(token),
    });

    expect(tokens).toEqual(['你', '好']);
    expect(output).toBe('你好');
  });
});
