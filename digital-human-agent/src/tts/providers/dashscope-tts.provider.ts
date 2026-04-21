import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { RawData, WebSocket } from 'ws';
import {
  DEFAULT_DASHSCOPE_TTS_BASE_URL,
  DEFAULT_TTS_MODEL_NAME,
  DEFAULT_TTS_PCM_SAMPLE_RATE,
  DEFAULT_TTS_SAMPLE_RATE,
  DEFAULT_TTS_VOICE_ID,
} from '@/common/constants';
import { TtsProvider, TtsSynthesizeStreamParams } from '@/tts/tts.types';
import { consumeSseEvents, SseEvent } from '@/tts/utils/sse.util';

interface DashscopeTtsResponse {
  request_id?: string;
  code?: string;
  message?: string;
  output?: {
    finish_reason?: string | null;
    type?: string;
    audio?: {
      data?: string;
      url?: string;
      id?: string;
      expires_at?: number;
    };
  };
}

interface DashscopeWsEventPayload {
  header?: {
    event?: string;
    error_code?: string;
    error_message?: string;
  };
}

type DashscopeTransportMode = 'ws' | 'http' | 'auto';

class DashscopeStreamUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DashscopeStreamUnsupportedError';
  }
}

@Injectable()
export class DashscopeTtsProvider implements TtsProvider {
  readonly name = 'dashscope';

  private readonly logger = new Logger(DashscopeTtsProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly wsUrl: string;
  private readonly workspaceId: string;
  private readonly modelName: string;
  private readonly defaultVoice: string;
  private readonly sampleRate: number;
  private readonly pcmSampleRate: number;
  private readonly transport: DashscopeTransportMode;

  constructor(private readonly configService: ConfigService) {
    this.apiKey =
      this.readString('TTS_API_KEY') ||
      this.readString('DASHSCOPE_API_KEY') ||
      this.readString('OPENAI_API_KEY');
    this.baseUrl = (
      this.readString('TTS_BASE_URL') || DEFAULT_DASHSCOPE_TTS_BASE_URL
    ).replace(/\/$/, '');
    this.wsUrl =
      this.readString('TTS_WS_URL') || this.buildDefaultWsUrl(this.baseUrl);
    this.workspaceId = this.readString('TTS_WORKSPACE_ID');
    this.modelName = this.readString('TTS_MODEL') || DEFAULT_TTS_MODEL_NAME;
    this.defaultVoice =
      this.readString('TTS_DEFAULT_VOICE') || DEFAULT_TTS_VOICE_ID;
    this.sampleRate = this.readNumber(
      'TTS_SAMPLE_RATE',
      DEFAULT_TTS_SAMPLE_RATE,
    );
    this.pcmSampleRate = this.readNumber(
      'TTS_PCM_SAMPLE_RATE',
      DEFAULT_TTS_PCM_SAMPLE_RATE,
    );
    this.transport = this.readTransport();
  }

  async synthesizeStream({
    text,
    voiceId,
    signal,
    onChunk,
    outputFormat,
  }: TtsSynthesizeStreamParams): Promise<void> {
    if (signal.aborted || !text.trim()) return;
    this.ensureConfigReady();

    const voice = this.resolveVoice(voiceId);
    const format = outputFormat === 'pcm' ? 'pcm' : 'mp3';
    const sampleRate =
      outputFormat === 'pcm' ? this.pcmSampleRate : this.sampleRate;
    const requestBody = {
      model: this.modelName,
      input: {
        text,
        voice,
        format,
        sample_rate: sampleRate,
      },
    };

    this.logger.log(
      `[TTS] dashscope synthesize start model=${this.modelName}, voice=${voice}, format=${format}, text="${text.slice(0, 30)}..."`,
    );

    if (this.transport === 'http') {
      await this.synthesizeByHttp(requestBody, signal, onChunk);
      return;
    }

    try {
      await this.synthesizeByWebSocket(
        text,
        voice,
        format,
        sampleRate,
        signal,
        onChunk,
      );
      return;
    } catch (error) {
      if (this.transport === 'ws' || !this.shouldFallbackToHttp(error)) {
        throw error;
      }

      this.logger.warn(
        `DashScope WebSocket TTS 不可用，自动降级为 HTTP: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    await this.synthesizeByHttp(requestBody, signal, onChunk);
  }

  private async synthesizeByWebSocket(
    text: string,
    voice: string,
    format: 'mp3' | 'pcm',
    sampleRate: number,
    signal: AbortSignal,
    onChunk: (chunk: Buffer) => void,
  ): Promise<void> {
    const taskId = randomUUID();

    await new Promise<void>((resolve, reject) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        'user-agent': 'digital-human-agent/tts',
      };
      if (this.workspaceId) {
        headers['X-DashScope-WorkSpace'] = this.workspaceId;
      }

      const socket = new WebSocket(this.wsUrl, { headers });
      let settled = false;
      let taskStarted = false;
      let taskFinished = false;

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
        socket.removeAllListeners();
      };

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();

        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close();
        }

        if (error) {
          reject(error);
          return;
        }
        resolve();
      };

      const onAbort = () => {
        finish(this.createAbortError());
      };

      signal.addEventListener('abort', onAbort, { once: true });

      socket.on('open', () => {
        if (signal.aborted) {
          finish(this.createAbortError());
          return;
        }

        socket.send(
          JSON.stringify({
            header: {
              action: 'run-task',
              task_id: taskId,
              streaming: 'duplex',
            },
            payload: {
              task_group: 'audio',
              task: 'tts',
              function: 'SpeechSynthesizer',
              model: this.modelName,
              parameters: {
                text_type: 'PlainText',
                voice,
                format,
                sample_rate: sampleRate,
                volume: 50,
                rate: 1,
                pitch: 1,
              },
              input: {},
            },
          }),
        );
      });

      socket.on('message', (data: RawData, isBinary: boolean) => {
        if (isBinary) {
          const chunk = this.normalizeBinaryFrame(data);
          if (chunk.length > 0) {
            onChunk(chunk);
          }
          return;
        }

        const message = this.parseWebSocketEvent(data);
        const event = message.header?.event ?? '';

        switch (event) {
          case 'task-started':
            taskStarted = true;
            socket.send(
              JSON.stringify({
                header: {
                  action: 'continue-task',
                  task_id: taskId,
                  streaming: 'duplex',
                },
                payload: {
                  input: {
                    text,
                  },
                },
              }),
            );
            socket.send(
              JSON.stringify({
                header: {
                  action: 'finish-task',
                  task_id: taskId,
                  streaming: 'duplex',
                },
                payload: {
                  input: {},
                },
              }),
            );
            return;
          case 'task-finished':
            taskFinished = true;
            finish();
            return;
          case 'task-failed':
            finish(
              new Error(
                `DashScope TTS task failed [${message.header?.error_code ?? 'unknown'}]: ${
                  message.header?.error_message ?? '未知错误'
                }`,
              ),
            );
            return;
          default:
            return;
        }
      });

      socket.on('error', (error) => {
        finish(error instanceof Error ? error : new Error(String(error ?? '')));
      });

      socket.on('close', (code, reason) => {
        if (settled) return;
        if (signal.aborted) {
          finish(this.createAbortError());
          return;
        }
        if (taskFinished) {
          finish();
          return;
        }

        const reasonText = reason.toString('utf-8');
        finish(
          new Error(
            taskStarted
              ? `DashScope TTS WebSocket 提前关闭: code=${code}, reason=${reasonText}`
              : `DashScope TTS WebSocket 建连失败: code=${code}, reason=${reasonText}`,
          ),
        );
      });
    });
  }

  private async synthesizeByHttp(
    requestBody: Record<string, unknown>,
    signal: AbortSignal,
    onChunk: (chunk: Buffer) => void,
  ): Promise<void> {
    try {
      await this.synthesizeByHttpStream(requestBody, signal, onChunk);
      return;
    } catch (error) {
      if (!this.shouldFallbackToNonStream(error)) {
        throw error;
      }

      this.logger.warn(
        `DashScope 流式 HTTP TTS 不可用，自动降级为非流式下载: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    await this.synthesizeByNonStream(requestBody, signal, onChunk);
  }

  private async synthesizeByHttpStream(
    requestBody: Record<string, unknown>,
    signal: AbortSignal,
    onChunk: (chunk: Buffer) => void,
  ): Promise<void> {
    const res = await this.fetchSpeechSynthesis(requestBody, signal, true);
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();

    if (contentType.includes('text/event-stream') && res.body) {
      await consumeSseEvents(
        res.body,
        (event) => this.handleHttpStreamEvent(event, onChunk),
        signal,
      );
      return;
    }

    if (contentType.includes('application/json')) {
      const payload = (await res.json()) as DashscopeTtsResponse;
      if (this.isStreamUnsupportedPayload(payload)) {
        throw new DashscopeStreamUnsupportedError(
          payload.message ?? '当前账号不支持流式 HTTP TTS',
        );
      }
      await this.emitAudioChunkOrDownload(payload, onChunk, signal);
      return;
    }

    const whole = Buffer.from(await res.arrayBuffer());
    if (whole.length > 0) {
      onChunk(whole);
    }
  }

  private async synthesizeByNonStream(
    requestBody: Record<string, unknown>,
    signal: AbortSignal,
    onChunk: (chunk: Buffer) => void,
  ): Promise<void> {
    const res = await this.fetchSpeechSynthesis(requestBody, signal, false);
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();

    if (contentType.includes('application/json')) {
      const payload = (await res.json()) as DashscopeTtsResponse;
      await this.emitAudioChunkOrDownload(payload, onChunk, signal);
      return;
    }

    if (!res.body) {
      const whole = Buffer.from(await res.arrayBuffer());
      if (whole.length > 0) {
        onChunk(whole);
      }
      return;
    }

    await this.pipeBinaryResponse(res, onChunk, signal);
  }

  private async fetchSpeechSynthesis(
    requestBody: Record<string, unknown>,
    signal: AbortSignal,
    streamMode: boolean,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (streamMode) {
      headers['X-DashScope-SSE'] = 'enable';
    }

    const res = await fetch(
      `${this.baseUrl}/api/v1/services/audio/tts/SpeechSynthesizer`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal,
      },
    );

    if (!res.ok) {
      const bodyText = await res.text();
      throw new Error(`TTS HTTP ${res.status}: ${bodyText}`);
    }

    return res;
  }

  private handleHttpStreamEvent(
    event: SseEvent,
    onChunk: (chunk: Buffer) => void,
  ): void {
    const payload = JSON.parse(event.data) as DashscopeTtsResponse;
    if (event.event === 'error') {
      if (this.isStreamUnsupportedPayload(payload)) {
        throw new DashscopeStreamUnsupportedError(
          payload.message ?? '当前账号不支持流式 HTTP TTS',
        );
      }
      throw new Error(
        `DashScope TTS SSE error: ${payload.message ?? event.data}`,
      );
    }

    this.emitAudioChunk(payload, onChunk);
  }

  private emitAudioChunk(
    payload: DashscopeTtsResponse,
    onChunk: (chunk: Buffer) => void,
  ): void {
    const base64Audio = payload.output?.audio?.data;
    if (!base64Audio) return;

    const chunk = Buffer.from(base64Audio, 'base64');
    if (chunk.length > 0) {
      onChunk(chunk);
    }
  }

  private async emitAudioChunkOrDownload(
    payload: DashscopeTtsResponse,
    onChunk: (chunk: Buffer) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const base64Audio = payload.output?.audio?.data;
    if (base64Audio) {
      this.emitAudioChunk(payload, onChunk);
      return;
    }

    const audioUrl = payload.output?.audio?.url;
    if (!audioUrl) {
      throw new Error('DashScope TTS 响应中未返回音频数据或音频地址');
    }

    const downloadResponse = await fetch(audioUrl, { signal });
    if (!downloadResponse.ok) {
      const bodyText = await downloadResponse.text();
      throw new Error(
        `DashScope TTS 音频下载失败 HTTP ${downloadResponse.status}: ${bodyText}`,
      );
    }

    await this.pipeBinaryResponse(downloadResponse, onChunk, signal);
  }

  private async pipeBinaryResponse(
    response: Response,
    onChunk: (chunk: Buffer) => void,
    signal: AbortSignal,
  ): Promise<void> {
    if (!response.body) {
      const whole = Buffer.from(await response.arrayBuffer());
      if (whole.length > 0) {
        onChunk(whole);
      }
      return;
    }

    const reader = response.body.getReader();
    try {
      while (true) {
        if (signal.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

        onChunk(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
  }

  private resolveVoice(voiceId: string | null): string {
    if (!voiceId) return this.defaultVoice;
    return voiceId.trim() || this.defaultVoice;
  }

  private shouldFallbackToNonStream(error: unknown): boolean {
    return error instanceof DashscopeStreamUnsupportedError;
  }

  private shouldFallbackToHttp(error: unknown): boolean {
    if (error instanceof DashscopeStreamUnsupportedError) {
      return true;
    }

    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error);
    return (
      message.includes('unexpected server response') ||
      message.includes('websocket') ||
      message.includes('econnreset') ||
      message.includes('etimedout')
    );
  }

  private isStreamUnsupportedPayload(payload: DashscopeTtsResponse): boolean {
    const code = (payload.code ?? '').trim();
    const message = (payload.message ?? '').trim().toLowerCase();
    return (
      code === 'InvalidParameter' &&
      message.includes('does not support stream call')
    );
  }

  private ensureConfigReady(): void {
    if (!this.apiKey || !this.baseUrl) {
      throw new InternalServerErrorException(
        'TTS 配置缺失：请设置 TTS_API_KEY（或 DASHSCOPE_API_KEY）与 TTS_BASE_URL',
      );
    }
  }

  private buildDefaultWsUrl(baseUrl: string): string {
    const wsBase = baseUrl
      .replace(/^https:\/\//i, 'wss://')
      .replace(/^http:\/\//i, 'ws://');
    return `${wsBase}/api-ws/v1/inference/`;
  }

  private readString(key: string): string {
    return (this.configService.get<string>(key) ?? '').trim();
  }

  private readNumber(key: string, fallback: number): number {
    const rawValue = this.readString(key);
    const parsed = Number(rawValue);
    if (!rawValue || !Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  private readTransport(): DashscopeTransportMode {
    const value = this.readString('TTS_TRANSPORT').toLowerCase();
    if (value === 'http' || value === 'auto') {
      return value;
    }
    return 'ws';
  }

  private parseWebSocketEvent(data: RawData): DashscopeWsEventPayload {
    const text = this.normalizeBinaryFrame(data).toString('utf-8');
    return JSON.parse(text) as DashscopeWsEventPayload;
  }

  private normalizeBinaryFrame(data: RawData): Buffer {
    if (Buffer.isBuffer(data)) {
      return data;
    }
    if (Array.isArray(data)) {
      return Buffer.concat(data.map((item) => Buffer.from(item)));
    }
    if (ArrayBuffer.isView(data)) {
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
    return Buffer.from(data);
  }

  private createAbortError(): Error {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    return error;
  }
}
