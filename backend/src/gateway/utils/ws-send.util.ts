import { WebSocket } from 'ws';
import { WsOutboundMessage } from '@/gateway/gateway.types';

/**
 * 安全地通过 WebSocket 发送强类型的 JSON 消息。
 *
 * @param client WebSocket 客户端实例
 * @param msg 符合 WsOutboundMessage 规范的出站消息对象
 */
export function sendJson<T extends WsOutboundMessage>(
  client: WebSocket,
  msg: T,
): void {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(msg));
  }
}

