import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskEvent } from '@/event/entities/task-event.entity';
import { EventLogService } from '@/event/event-log.service';
import { EventPublisher } from '@/event/event.publisher';

@Module({
  imports: [TypeOrmModule.forFeature([TaskEvent])],
  providers: [EventLogService, EventPublisher],
  exports: [EventLogService, EventPublisher],
})
export class EventModule {}
