import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { AiService } from '../ai/ai.service';
import { TencentTtsSession, type TencentTtsConfig } from './tencent-tts-session';

/**
 * 单 WebSocket 通道，同时传输 AI 文字（JSON）和 TTS 音频（Binary）。
 *
 * 客户端协议：
 *   发送: { type: 'query', text: '你的问题' }
 *   接收: { type: 'text_chunk', chunk: '...' }  ← AI 流式文字（字幕）
 *   接收: <Binary>                              ← TTS 音频数据
 *   接收: { type: 'done' }                      ← 本轮结束
 *   接收: { type: 'error', message: '...' }     ← 出错
 */
@Injectable()
export class SpeechGateway implements OnApplicationBootstrap {
  private readonly logger = new Logger(SpeechGateway.name);
  private readonly tencentConfig: TencentTtsConfig;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly aiService: AiService,
    @Inject(ConfigService) configService: ConfigService,
  ) {
    this.tencentConfig = {
      secretId:  configService.get<string>('SECRET_ID')       ?? '',
      secretKey: configService.get<string>('SECRET_KEY')      ?? '',
      appId:     Number(configService.get<string>('APP_ID')   ?? 0),
      voiceType: Number(configService.get<string>('TTS_VOICE_TYPE') ?? 101001),
    };
  }

  onApplicationBootstrap() {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();
    const wss = new WebSocketServer({ server: httpServer, path: '/ws/speech' });

    wss.on('connection', (ws) => {
      this.logger.log('Client connected');

      // 每个连接记录当前活跃的 TTS session，新 query 来时关掉上一个
      let activeTts: TencentTtsSession | null = null;

      ws.on('message', (data) => {
        let msg: { type: string; text?: string };
        try { msg = JSON.parse(data.toString()); } catch { return; }

        if (msg.type === 'query' && msg.text) {
          // 如果上一个问题还在处理，先中断
          activeTts?.close();
          activeTts = null;

          this.handleQuery(ws, msg.text, (tts) => { activeTts = tts; })
            .catch((err: Error) => {
              this.logger.error(`handleQuery error: ${err.message}`);
              this.sendJson(ws, { type: 'error', message: err.message });
            });
        }
      });

      ws.on('close', () => {
        activeTts?.close();
        this.logger.log('Client disconnected');
      });
    });

    this.logger.log('SpeechGateway listening at ws://…/ws/speech');
  }

  /**
   * 处理一次对话：
   * 1. 建立腾讯 TTS 连接
   * 2. AI 流式生成 → 同时发文字给客户端 + 发给 TTS
   * 3. TTS 音频 → 直接发给客户端
   */
  private async handleQuery(
    ws: WebSocket,
    query: string,
    onTtsCreated: (tts: TencentTtsSession) => void,
  ): Promise<void> {
    const tts = new TencentTtsSession(this.tencentConfig);
    onTtsCreated(tts);

    // 腾讯 TTS 返回音频 → 转发给客户端（Binary 帧）
    tts.onAudio((binary) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(binary);
    });

    // TTS 合成结束 → 通知客户端本轮完成
    tts.onFinal(() => {
      this.sendJson(ws, { type: 'done' });
      tts.close();
    });

    tts.onError((err) => {
      this.sendJson(ws, { type: 'error', message: err });
    });

    await tts.connect();

    try {
      // AI 流式生成，每个 chunk 同时走两条路
      for await (const chunk of this.aiService.streamChain(query)) {
        if (ws.readyState !== WebSocket.OPEN) break;

        // 路径 1：发给前端显示字幕
        this.sendJson(ws, { type: 'text_chunk', chunk });

        // 路径 2：发给腾讯 TTS 合成语音
        tts.sendText(chunk);
      }

      // AI 生成完毕，通知 TTS 可以输出剩余音频
      tts.complete();
    } catch (err) {
      tts.close();
      throw err;
    }
  }

  private sendJson(ws: WebSocket, payload: Record<string, unknown>) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}
