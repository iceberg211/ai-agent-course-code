import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { EventLogService } from '@/event/event-log.service';

@Injectable()
export class EventPublisher {
  constructor(
    private readonly emitter: EventEmitter2,
    private readonly eventLog: EventLogService,
  ) {}

  emit(event: string, payload: Record<string, unknown>): void {
    const enrichedPayload = {
      ...payload,
      _eventId: randomUUID(),
      _eventName: event,
      _eventCreatedAt: new Date().toISOString(),
    };

    void this.eventLog.record(event, enrichedPayload);
    this.emitter.emit(event, enrichedPayload);
  }
}
