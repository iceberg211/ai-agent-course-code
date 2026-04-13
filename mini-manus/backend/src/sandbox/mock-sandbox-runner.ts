import {
  SandboxRunner,
  SandboxRunOptions,
  SandboxRunResult,
} from '@/sandbox/sandbox-runner.interface';

/**
 * MockSandboxRunner — S0 阶段的伪实现，用于单元测试和 CI。
 *
 * 不依赖 Docker，直接返回可配置的预设结果。
 * 注入时通过 provide: SANDBOX_RUNNER 替换掉真实 runner。
 */
export class MockSandboxRunner implements SandboxRunner {
  private presetResult: Partial<SandboxRunResult> = {};

  /** 测试时配置预设的执行结果 */
  setPreset(result: Partial<SandboxRunResult>): void {
    this.presetResult = result;
  }

  async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
    return {
      stdout: this.presetResult.stdout ?? `Mock: executed ${options.entryFile} with ${options.runtime}`,
      stderr: this.presetResult.stderr ?? '',
      exitCode: this.presetResult.exitCode ?? 0,
      durationMs: this.presetResult.durationMs ?? 42,
      truncated: this.presetResult.truncated ?? false,
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
