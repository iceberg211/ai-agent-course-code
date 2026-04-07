import { createHmac, randomUUID } from 'node:crypto';
import WebSocket from 'ws';

export interface TencentTtsConfig {
  secretId: string;
  secretKey: string;
  appId: number;
  voiceType: number;
}

/**
 * 封装一次对话的腾讯 TTS WebSocket 连接。
 * 生命周期：connect() → sendText() × N → complete() → (自动关闭)
 */
export class TencentTtsSession {
  private ws!: WebSocket;
  private ready = false;
  private closed = false;
  private pendingTexts: string[] = []; // ready=1 前缓存的文字
  private readyTimer!: NodeJS.Timeout;
  private readonly sessionId = randomUUID();

  private onAudioCb?: (data: Buffer) => void;
  private onFinalCb?: () => void;
  private onErrorCb?: (err: string) => void;

  constructor(private readonly config: TencentTtsConfig) {}

  onAudio(cb: (data: Buffer) => void) { this.onAudioCb = cb; }
  onFinal(cb: () => void)             { this.onFinalCb = cb; }
  onError(cb: (err: string) => void)  { this.onErrorCb = cb; }

  /** 建立 WebSocket 连接，open 后 resolve（ready=1 才能发文字，send 前会自动缓冲）*/
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.buildUrl());

      // 5 秒内没收到 ready=1，认为连接异常
      this.readyTimer = setTimeout(() => {
        reject(new Error('Tencent TTS ready timeout (5s)'));
        this.close();
      }, 5000);

      this.ws.on('open', () => resolve());

      this.ws.on('message', (data, isBinary) => {
        if (this.closed) return;

        // 腾讯 TTS 返回音频二进制 → 直接转发给调用方
        if (isBinary) {
          this.onAudioCb?.(data as Buffer);
          return;
        }

        let msg: Record<string, unknown>;
        try { msg = JSON.parse(data.toString()); } catch { return; }

        // ready=1：可以发文字了，把之前缓存的全部刷出去
        if (Number(msg.ready) === 1) {
          clearTimeout(this.readyTimer);
          this.ready = true;
          this.flushPending();
        }

        // 腾讯返回错误码
        if (Number(msg.code) && Number(msg.code) !== 0) {
          this.onErrorCb?.(String(msg.message ?? 'Tencent TTS error'));
          this.close();
          return;
        }

        // final=1：本次合成结束
        if (Number(msg.final) === 1) {
          this.onFinalCb?.();
        }
      });

      this.ws.on('error', (err) => {
        clearTimeout(this.readyTimer);
        reject(err);
        this.onErrorCb?.(err.message);
      });

      this.ws.on('close', () => { this.ready = false; });
    });
  }

  /** 发送一段文字进行合成，ready 前自动缓存 */
  sendText(text: string) {
    if (this.closed || !text.trim()) return;
    if (!this.ready) {
      this.pendingTexts.push(text);
      return;
    }
    this.doSend(text);
  }

  /** 通知腾讯 TTS 文字已全部发完，可以输出剩余音频 */
  complete() {
    this.flushPending();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        session_id: this.sessionId,
        action: 'ACTION_COMPLETE',
      }));
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.readyTimer);
    if (this.ws?.readyState < WebSocket.CLOSING) {
      this.ws.close();
    }
  }

  private flushPending() {
    while (this.pendingTexts.length > 0 && this.ready) {
      this.doSend(this.pendingTexts.shift()!);
    }
  }

  private doSend(text: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.pendingTexts.unshift(text); // WS 意外关闭，回退到缓冲
      return;
    }
    this.ws.send(JSON.stringify({
      session_id: this.sessionId,
      message_id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      action: 'ACTION_SYNTHESIS',
      data: text,
    }));
  }

  private buildUrl(): string {
    const now = Math.floor(Date.now() / 1000);
    const params: Record<string, string | number> = {
      Action: 'TextToStreamAudioWSv2',
      AppId: this.config.appId,
      Codec: 'mp3',
      Expired: now + 3600,
      SampleRate: 16000,
      SecretId: this.config.secretId,
      SessionId: this.sessionId,
      Speed: 0,
      Timestamp: now,
      VoiceType: this.config.voiceType,
      Volume: 5,
    };

    const signStr = Object.keys(params).sort()
      .map(k => `${k}=${params[k]}`).join('&');
    const rawStr = `GETtts.cloud.tencent.com/stream_wsv2?${signStr}`;
    const signature = createHmac('sha1', this.config.secretKey)
      .update(rawStr).digest('base64');

    const searchParams = new URLSearchParams({
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      Signature: signature,
    });

    return `wss://tts.cloud.tencent.com/stream_wsv2?${searchParams.toString()}`;
  }
}
