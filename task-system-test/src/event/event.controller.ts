import { Controller, Get, Param, Sse, MessageEvent } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable } from 'rxjs';
import { fromEvent } from 'rxjs';
import { map, filter } from 'rxjs/operators';

@Controller('event')
export class EventController {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * 建立对应任务的 SSE 连接
   * 通过 GET /event/task/:id SSE 可以持续获取事件流推送
   */
  @Sse('task/:id')
  taskEvents(@Param('id') taskId: string): Observable<MessageEvent> {
    console.log(`[SSE] Client connected via task SSE: ${taskId}`);
    
    // 监听所有 task.* 和 step.* 事件，这里简单地合并用通配符
    return fromEvent(this.eventEmitter, '**').pipe(
      // eventArgs 格式依你的 eventEmitter 触发情况定义，此处简单处理：
      // (eventName, payload) if emitted as emit(event, payload) - WAIT! Nestjs eventEmitter2 does not automatically pass event name this way if catching via wildcard directly.
      // We will listen explicitly or define a mapped event.
      // The easiest way is to listen to specific events or wrap them. 
      // In this test, we simplify by injecting the task ID in our emits.
      filter((payload: any) => payload && payload.taskId === taskId),
      map((payload: any) => {
        // payload 会携带我们在 task.service 里发出的数据
        // 因为 fromEvent 用 wildcard 时可能只拿到第一个参数 payload
        const eventData = { data: payload };
        console.log(`[SSE] -> Pushing event data to client:`, Object.keys(payload));
        return {
          data: eventData,
        } as MessageEvent;
      }),
    );
  }
}
