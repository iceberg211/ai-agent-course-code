import { EventEmitter } from 'node:events';
import { RedisService } from '@/common/redis/redis.service';

describe('RedisService', () => {
  function createClient(status: string) {
    const emitter = new EventEmitter() as EventEmitter & {
      status: string;
      connect: jest.Mock<Promise<void>, []>;
      disconnect: jest.Mock<void, []>;
    };
    emitter.status = status;
    emitter.connect = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    emitter.disconnect = jest.fn<void, []>();
    return emitter;
  }

  function createService(client: ReturnType<typeof createClient>) {
    return new RedisService({ get: jest.fn() } as never, client as never);
  }

  it('并发连接只调用一次 connect，并在 ready 后返回客户端', async () => {
    const client = createClient('wait');
    client.connect.mockImplementation(() => {
      client.status = 'ready';
      return Promise.resolve();
    });
    const service = createService(client);

    const [first, second] = await Promise.all([
      service.ensureConnected(),
      service.ensureConnected(),
    ]);

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(first).toBe(client);
    expect(second).toBe(client);
  });

  it('连接中的客户端必须等待 ready 事件，不能提前返回不可用连接', async () => {
    const client = createClient('connecting');
    const service = createService(client);
    let settled = false;

    const pending = service.ensureConnected().then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    client.status = 'ready';
    client.emit('ready');

    await expect(pending).resolves.toBe(client);
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('连接报错后返回 null，避免调用方使用未就绪客户端', async () => {
    const client = createClient('connecting');
    const service = createService(client);
    const pending = service.ensureConnected();

    client.emit('error', new Error('redis unavailable'));

    await expect(pending).resolves.toBeNull();
  });
});
