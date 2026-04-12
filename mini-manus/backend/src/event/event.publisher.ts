import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventLogService } from '@/event/event-log.service';

@Injectable()
export class EventPublisher {
  constructor(
    private readonly emitter: EventEmitter2,
    private readonly eventLog: EventLogService,
  ) {}

  emit(event: string, payload: Record<string, unknown>): void {
    void this.eventLog.record(event, payload);
    this.emitter.emit(event, payload);
  }
}
