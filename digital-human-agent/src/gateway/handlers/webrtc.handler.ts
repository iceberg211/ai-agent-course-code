import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { DigitalHumanService } from '../../digital-human/digital-human.service';
import { RealtimeSessionRegistry } from '../../realtime-session/realtime-session.registry';
import {
  WsWebRtcAnswerMessage,
  WsWebRtcIceCandidateMessage,
} from '../gateway.types';

/**
 * 处理 WebRTC 信令消息（`webrtc:answer`、`webrtc:ice-candidate`）。
 *
 * 职责：
 * - 验证会话存在且为数字人模式
 * - 转发 SDP Answer 给 DigitalHumanService
 * - 转发 ICE Candidate 给 DigitalHumanService
 */
@Injectable()
export class WebRtcHandler {
  constructor(
    private readonly sessionRegistry: RealtimeSessionRegistry,
    private readonly digitalHumanService: DigitalHumanService,
  ) {}

  async handleAnswer(
    client: WebSocket,
    msg: WsWebRtcAnswerMessage,
  ): Promise<void> {
    const sessionId = String(msg?.sessionId ?? '');
    const session = this.sessionRegistry.get(sessionId);
    if (!session) return;

    if (session.mode !== 'digital-human' || !session.digitalHumanSessionId) {
      this.sendJson(client, {
        type: 'error',
        sessionId,
        payload: { message: '当前会话不是数字人模式' },
      });
      return;
    }

    const sdpAnswer = msg?.payload?.sdpAnswer;
    if (!sdpAnswer?.type) return;

    await this.digitalHumanService.setAnswer(
      session.digitalHumanSessionId,
      sdpAnswer,
    );
  }

  async handleIceCandidate(
    client: WebSocket,
    msg: WsWebRtcIceCandidateMessage,
  ): Promise<void> {
    const sessionId = String(msg?.sessionId ?? '');
    const session = this.sessionRegistry.get(sessionId);
    if (!session) return;

    if (session.mode !== 'digital-human' || !session.digitalHumanSessionId) {
      this.sendJson(client, {
        type: 'error',
        sessionId,
        payload: { message: '当前会话不是数字人模式' },
      });
      return;
    }

    const candidate = msg?.payload?.candidate;
    if (!candidate || typeof candidate !== 'object') return;

    await this.digitalHumanService.addIceCandidate(
      session.digitalHumanSessionId,
      candidate,
    );
  }

  private sendJson(client: WebSocket, msg: object): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  }
}
