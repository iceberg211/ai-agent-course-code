import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TASK_EVENTS } from '@/common/events/task.events';
import { TaskService } from '@/task/task.service';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/' })
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AgentGateway.name);

  constructor(private readonly taskService: TaskService) {}

  handleConnection(client: Socket) {
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
}
