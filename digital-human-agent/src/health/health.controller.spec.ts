import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '@/health/health.controller';
import { HealthService } from '@/health/health.service';

describe('HealthController', () => {
  const service = {
    check: jest.fn(),
  } as unknown as HealthService;
  const controller = new HealthController(service);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('健康检查正常时返回结果', async () => {
    jest.spyOn(service, 'check').mockResolvedValue({
      status: 'ok',
      timestamp: '2026-04-11T00:00:00.000Z',
      checks: {
        app: { status: 'ok' },
        db: { status: 'ok' },
        digitalHuman: { status: 'ok' },
        llm: { status: 'ok' },
      },
    });

    await expect(controller.getHealth()).resolves.toEqual(
      expect.objectContaining({ status: 'ok' }),
    );
  });

  it('健康检查异常时抛出 503', async () => {
    jest.spyOn(service, 'check').mockResolvedValue({
      status: 'error',
      timestamp: '2026-04-11T00:00:00.000Z',
      checks: {
        app: { status: 'ok' },
        db: { status: 'error' },
        digitalHuman: { status: 'ok' },
        llm: { status: 'ok' },
      },
    });

    await expect(controller.getHealth()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
