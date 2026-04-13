import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SandboxRunOptions,
  SandboxRunResult,
} from '@/sandbox/sandbox-runner.interface';
import { type SandboxRunner, SANDBOX_RUNNER } from '@/sandbox/sandbox-runner.interface';

/**
 * SandboxService：封装 SandboxRunner，提供上层调用接口。
 *
 * - 启动时检查 runner 可用性，不可用时 warn（不阻断启动）
 * - 执行前验证 runner 是否可用，不可用时抛 Error('sandbox_unavailable')
 */
@Injectable()
export class SandboxService implements OnModuleInit {
  private readonly logger = new Logger(SandboxService.name);
  readonly enabled: boolean;

  constructor(
    @Inject(SANDBOX_RUNNER) private readonly runner: SandboxRunner,
    private readonly config: ConfigService,
  ) {
    this.enabled =
      ['1', 'true', 'yes', 'on'].includes(
        (config.get<string>('SANDBOX_ENABLED') ?? '').toLowerCase(),
      );
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('代码执行沙箱未启用（SANDBOX_ENABLED=false）');
      return;
    }
    const available = await this.runner.isAvailable();
    if (!available) {
      this.logger.warn(
        '代码执行沙箱已启用，但 Docker Engine 不可达。代码执行工具将在调用时报错。',
      );
    } else {
      this.logger.log('代码执行沙箱就绪（Docker Engine 连通）');
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.runner.isAvailable();
  }

  async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
    if (!this.enabled) {
      throw new Error(
        '代码执行沙箱未启用，请设置 SANDBOX_ENABLED=true 并确保 Docker Engine 可用',
      );
    }
    const available = await this.runner.isAvailable();
    if (!available) {
      throw new Error('sandbox_unavailable: Docker Engine 不可达');
    }
    return this.runner.run(options);
  }
}
