import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { TASK_EVENTS } from '@/common/events/task.events';
import { TaskService } from '@/task/task.service';

function parseAllowedOrigins(raw: string | undefined): string[] {
  const fallback = ['http://localhost:5173'];
  if (!raw) return fallback;
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== '*');
  return origins.length > 0 ? origins : fallback;
}

const WS_CORS_ORIGINS = parseAllowedOrigins(
  process.env.WS_ALLOWED_ORIGINS ?? process.env.FRONTEND_URL,
);

@WebSocketGateway({
  cors: { origin: WS_CORS_ORIGINS, credentials: true },
  namespace: '/',
})
export class AgentGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AgentGateway.name);
  private readonly wsAuthToken: string;
  private readonly authRequired: boolean;

  constructor(
    private readonly taskService: TaskService,
    private readonly config: ConfigService,
  ) {
    this.wsAuthToken = this.config.get<string>('WS_AUTH_TOKEN', '').trim();
    this.authRequired = this.wsAuthToken.length > 0;
    if (!this.authRequired) {
      this.logger.warn(
        'WS_AUTH_TOKEN 未配置，WebSocket 连接仅依赖 CORS 约束（建议在生产环境开启 token 鉴权）',
      );
    }
  }

  afterInit(server: Server) {
    server.use((socket, next) => {
      if (!this.authRequired) {
        socket.data.authenticated = true;
        return next();
      }

      const token = this.extractSocketToken(socket);
      if (!token || token !== this.wsAuthToken) {
        return next(new Error('Unauthorized'));
      }

      socket.data.authenticated = true;
      return next();
    });
  }

  handleConnection(client: Socket) {
    if (!this.isAuthenticated(client)) {
      this.logger.warn(
        `Unauthorized websocket connection rejected: ${client.id}`,
      );
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  /** Client joins a task room to receive events for that task */
  @SubscribeMessage('join:task')
  async handleJoinTask(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { taskId: string },
  ) {
    if (!this.isAuthenticated(client)) {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }

    await client.join(`task:${data.taskId}`);
    // Send current snapshot so client can hydrate state
    try {
      const detail = await this.taskService.getTaskDetail(data.taskId);
      client.emit('task:snapshot', detail);
    } catch {
      client.emit('error', { message: 'Task not found' });
    }
  }

  @SubscribeMessage('leave:task')
  async handleLeaveTask(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { taskId: string },
  ) {
    await client.leave(`task:${data.taskId}`);
  }

  // ─── Forward all task events to the appropriate room ─────────────────
  private taskRoom(payload: Record<string, unknown>): string {
    return `task:${String(payload['taskId'])}`;
  }

  private isAuthenticated(client: Socket): boolean {
    return !this.authRequired || client.data.authenticated === true;
  }

  private extractSocketToken(client: Socket): string | null {
    const authToken =
      typeof client.handshake.auth?.token === 'string'
        ? client.handshake.auth.token.trim()
        : null;
    if (authToken) return authToken;

    const headerToken = client.handshake.headers['x-ws-token'];
    if (typeof headerToken === 'string' && headerToken.trim()) {
      return headerToken.trim();
    }
    if (Array.isArray(headerToken) && headerToken[0]?.trim()) {
      return headerToken[0].trim();
    }

    const queryToken = client.handshake.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim()) {
      return queryToken.trim();
    }

    return null;
  }

  @OnEvent(TASK_EVENTS.TASK_CREATED)
  onTaskCreated(payload: Record<string, unknown>) {
    this.server.emit(TASK_EVENTS.TASK_CREATED, payload);
  }

  @OnEvent(TASK_EVENTS.RUN_STARTED)
  onRunStarted(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.RUN_STARTED, payload);
  }

  @OnEvent(TASK_EVENTS.REVISION_CREATED)
  onRevisionCreated(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.REVISION_CREATED, payload);
  }

  @OnEvent(TASK_EVENTS.RUN_COMPLETED)
  onRunCompleted(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.RUN_COMPLETED, payload);
  }

  @OnEvent(TASK_EVENTS.RUN_FAILED)
  onRunFailed(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.RUN_FAILED, payload);
  }

  @OnEvent(TASK_EVENTS.RUN_CANCELLED)
  onRunCancelled(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.RUN_CANCELLED, payload);
  }

  @OnEvent(TASK_EVENTS.PLAN_GENERATING)
  onPlanGenerating(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.PLAN_GENERATING, payload);
  }

  @OnEvent(TASK_EVENTS.PLAN_CREATED)
  onPlanCreated(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.PLAN_CREATED, payload);
  }

  @OnEvent(TASK_EVENTS.STEP_STARTED)
  onStepStarted(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.STEP_STARTED, payload);
  }

  @OnEvent(TASK_EVENTS.STEP_PROGRESS)
  onStepProgress(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.STEP_PROGRESS, payload);
  }

  @OnEvent(TASK_EVENTS.STEP_COMPLETED)
  onStepCompleted(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.STEP_COMPLETED, payload);
  }

  @OnEvent(TASK_EVENTS.STEP_FAILED)
  onStepFailed(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.STEP_FAILED, payload);
  }

  @OnEvent(TASK_EVENTS.TOOL_CALLED)
  onToolCalled(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.TOOL_CALLED, payload);
  }

  @OnEvent(TASK_EVENTS.TOOL_COMPLETED)
  onToolCompleted(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.TOOL_COMPLETED, payload);
  }

  @OnEvent(TASK_EVENTS.ARTIFACT_CREATED)
  onArtifactCreated(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.ARTIFACT_CREATED, payload);
  }

  @OnEvent(TASK_EVENTS.RUN_TOKEN_USAGE)
  onRunTokenUsage(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.RUN_TOKEN_USAGE, payload);
  }

  @OnEvent(TASK_EVENTS.RUN_AWAITING_APPROVAL)
  onRunAwaitingApproval(payload: Record<string, unknown>) {
    this.server
      .to(this.taskRoom(payload))
      .emit(TASK_EVENTS.RUN_AWAITING_APPROVAL, payload);
  }
}
