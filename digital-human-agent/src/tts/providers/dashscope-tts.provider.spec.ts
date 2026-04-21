import { ConfigService } from '@nestjs/config';
import { DashscopeTtsProvider } from '@/tts/providers/dashscope-tts.provider';

describe('DashscopeTtsProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('能够解析 DashScope SSE 音频块', async () => {
    const provider = new DashscopeTtsProvider(
      new ConfigService({
        TTS_API_KEY: 'test-key',
        TTS_BASE_URL: 'https://dashscope.aliyuncs.com',
        TTS_MODEL: 'cosyvoice-v1',
        TTS_DEFAULT_VOICE: 'longxiaochun',
        TTS_TRANSPORT: 'http',
      }),
    );

    const chunk1 = Buffer.from('hello-');
    const chunk2 = Buffer.from('world');

    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        [
          'data: {"request_id":"req-1","output":{"type":"sentence-synthesis","audio":{"data":"' +
            chunk1.toString('base64') +
            '"}}}\n\n',
          'data: {"request_id":"req-1","output":{"type":"sentence-synthesis","audio":{"data":"' +
            chunk2.toString('base64') +
            '"}}}\n\n',
          'data: {"request_id":"req-1","output":{"finish_reason":"stop","audio":{"data":""}}}\n\n',
        ].join(''),
        {
          headers: {
            'Content-Type': 'text/event-stream',
          },
        },
      ),
    ) as typeof fetch;

    const chunks: Buffer[] = [];

    await provider.synthesizeStream({
      text: '你好，帮我播报一下。',
      voiceId: null,
      signal: new AbortController().signal,
      outputFormat: 'mp3',
      onChunk: (chunk) => chunks.push(chunk),
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-DashScope-SSE': 'enable',
        }),
      }),
    );
    expect(Buffer.concat(chunks).toString()).toBe('hello-world');
  });

  it('响应失败时抛出带状态码的错误', async () => {
    const provider = new DashscopeTtsProvider(
      new ConfigService({
        TTS_API_KEY: 'test-key',
        TTS_BASE_URL: 'https://dashscope.aliyuncs.com',
        TTS_TRANSPORT: 'http',
      }),
    );

    global.fetch = jest.fn().mockResolvedValue(
      new Response('Not Found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain',
        },
      }),
    ) as typeof fetch;

    await expect(
      provider.synthesizeStream({
        text: '测试',
        voiceId: null,
        signal: new AbortController().signal,
        outputFormat: 'mp3',
        onChunk: () => undefined,
      }),
    ).rejects.toThrow('TTS HTTP 404');
  });

  it('流式不支持时会自动降级为非流式下载', async () => {
    const provider = new DashscopeTtsProvider(
      new ConfigService({
        TTS_API_KEY: 'test-key',
        TTS_BASE_URL: 'https://dashscope.aliyuncs.com',
        TTS_TRANSPORT: 'http',
      }),
    );

    const audioChunk = Buffer.from('fallback-audio');
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          'id:1\nevent:error\ndata:{"code":"InvalidParameter","message":"current user api does not support stream call"}\n\n',
          {
            headers: {
              'Content-Type': 'text/event-stream',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            request_id: 'req-fallback',
            output: {
              finish_reason: 'stop',
              audio: {
                data: '',
                url: 'https://example.com/fallback.mp3',
              },
            },
          }),
          {
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(audioChunk, {
          headers: {
            'Content-Type': 'audio/mpeg',
          },
        }),
      ) as typeof fetch;

    const chunks: Buffer[] = [];
    await provider.synthesizeStream({
      text: '测试降级',
      voiceId: null,
      signal: new AbortController().signal,
      outputFormat: 'mp3',
      onChunk: (chunk) => chunks.push(chunk),
    });

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(Buffer.concat(chunks).toString()).toBe('fallback-audio');
  });
});
