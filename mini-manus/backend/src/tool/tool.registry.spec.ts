import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { ToolRegistry } from '@/tool/tool.registry';
import { Tool } from '@/tool/interfaces/tool.interface';

function createRegistry(): ToolRegistry {
  return new ToolRegistry({
    get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
  } as unknown as ConfigService);
}

describe('ToolRegistry', () => {
  it('read-only 工具默认缓存成功结果', async () => {
    const registry = createRegistry();
    const execute = jest.fn().mockResolvedValue({
      success: true,
      output: 'ok',
    });
    registry.register({
      name: 'cached_tool',
      description: 'cached',
      schema: z.object({ q: z.string() }),
      type: 'read-only',
      execute,
    } as Tool);

    await registry.executeWithCache('cached_tool', { q: 'a' });
    const second = await registry.executeWithCache('cached_tool', { q: 'a' });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(second.cached).toBe(true);
  });

  it('cacheable=false 的 read-only 工具不走缓存', async () => {
    const registry = createRegistry();
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ success: true, output: 'first' })
      .mockResolvedValueOnce({ success: true, output: 'second' });
    registry.register({
      name: 'live_tool',
      description: 'live',
      schema: z.object({ q: z.string() }),
      type: 'read-only',
      cacheable: false,
      execute,
    } as Tool);

    const first = await registry.executeWithCache('live_tool', { q: 'a' });
    const second = await registry.executeWithCache('live_tool', { q: 'a' });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(first.output).toBe('first');
    expect(second.output).toBe('second');
    expect(second.cached).toBe(false);
  });
});
