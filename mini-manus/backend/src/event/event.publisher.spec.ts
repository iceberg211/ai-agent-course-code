import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventLogService } from '@/event/event-log.service';
import { EventPublisher } from '@/event/event.publisher';

describe('EventPublisher', () => {
  it('先请求持久化事件，再发送内存事件', () => {
    const emitter = { emit: jest.fn() } as unknown as EventEmitter2;
    const eventLog = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as EventLogService;
    const publisher = new EventPublisher(emitter, eventLog);
    const payload = { taskId: '00000000-0000-4000-8000-000000000001' };

    publisher.emit('task.created', payload);

    const persistedPayload = (eventLog.record as jest.Mock).mock.calls[0][1];
    expect(persistedPayload).toEqual(
      expect.objectContaining({
        ...payload,
        _eventId: expect.any(String),
        _eventName: 'task.created',
        _eventCreatedAt: expect.any(String),
      }),
    );
    expect(emitter.emit).toHaveBeenCalledWith('task.created', persistedPayload);
  });
});
