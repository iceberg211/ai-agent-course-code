import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SandboxService } from '@/sandbox/sandbox.service';
import { MockSandboxRunner } from '@/sandbox/mock-sandbox-runner';
import { SANDBOX_RUNNER } from '@/sandbox/sandbox-runner.interface';

function createModule(sandboxEnabled: boolean) {
  const mockRunner = new MockSandboxRunner();
  return Test.createTestingModule({
    providers: [
      { provide: SANDBOX_RUNNER, useValue: mockRunner },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string, def?: unknown) =>
            key === 'SANDBOX_ENABLED' ? (sandboxEnabled ? 'true' : 'false') : def,
        },
      },
      SandboxService,
    ],
  })
    .compile()
    .then(async (m: TestingModule) => {
      await m.get(SandboxService).onModuleInit();
      return { service: m.get(SandboxService), runner: mockRunner };
    });
}

describe('SandboxService', () => {
  describe('disabled', () => {
    it('run() throws when sandbox is disabled', async () => {
      const { service } = await createModule(false);
      await expect(
        service.run({
          taskId: '00000000-0000-0000-0000-000000000001',
          runtime: 'node',
          entryFile: 'index.js',
          timeoutMs: 5000,
        }),
      ).rejects.toThrow(/SANDBOX_ENABLED/);
    });
  });

  describe('enabled with mock runner', () => {
    it('run() returns mock result', async () => {
      const { service, runner } = await createModule(true);
      runner.setPreset({ stdout: 'Hello', exitCode: 0, durationMs: 10 });
      const result = await service.run({
        taskId: '00000000-0000-0000-0000-000000000001',
        runtime: 'node',
        entryFile: 'index.js',
        timeoutMs: 5000,
      });
      expect(result.stdout).toBe('Hello');
      expect(result.exitCode).toBe(0);
    });

    it('isAvailable() returns true for mock runner', async () => {
      const { service } = await createModule(true);
      await expect(service.isAvailable()).resolves.toBe(true);
    });

    it('run() propagates non-zero exitCode', async () => {
      const { service, runner } = await createModule(true);
      runner.setPreset({ stdout: '', stderr: 'SyntaxError', exitCode: 1 });
      const result = await service.run({
        taskId: '00000000-0000-0000-0000-000000000001',
        runtime: 'python',
        entryFile: 'main.py',
        timeoutMs: 5000,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('SyntaxError');
    });
  });
});
