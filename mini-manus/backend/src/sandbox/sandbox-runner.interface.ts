/**
 * SandboxRunner — 代码执行沙箱的核心抽象接口。
 *
 * S0 阶段：只定义接口 + MockRunner，不依赖 Docker，用于单元测试。
 * S1 阶段：接入 DockerRunner，使用 dockerode 通过 Unix Socket 与 Docker Engine 通信。
 *
 * 安全约束（S1 实施，详见文档 §8.6）：
 * - 无网络（--network=none）
 * - 只挂载当前 task workspace（rw），基础镜像以 ro 挂载
 * - 禁止挂载宿主机 Docker socket（否则容器可反控宿主机）
 * - 非 root 用户运行（--user 1000:1000）
 * - --cap-drop=ALL，--security-opt=no-new-privileges
 * - --pids-limit=100，防止 fork bomb
 * - 限制 CPU、内存、运行时长
 */

export type SandboxRuntime = 'node' | 'python';

export interface SandboxRunOptions {
  taskId: string;
  runtime: SandboxRuntime;
  /** 相对于 task workspace 的入口文件路径 */
  entryFile: string;
  timeoutMs: number;
  memoryLimitMb?: number;   // 默认 256
  networkDisabled?: boolean; // 默认 true（生产必须 true）
  maxOutputLength?: number;  // stdout/stderr 截断长度，默认 10000
}

export interface SandboxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  /** stdout 或 stderr 是否因超长被截断 */
  truncated: boolean;
}

export interface SandboxRunner {
  /**
   * 在隔离环境中执行代码文件。
   * - 超时时抛出 Error('sandbox_timeout')
   * - Docker 不可用时抛出 Error('sandbox_unavailable')
   */
  run(options: SandboxRunOptions): Promise<SandboxRunResult>;

  /** 检查 runner 是否可用（Docker Engine 连通性 / mock 始终返回 true） */
  isAvailable(): Promise<boolean>;
}

export const SANDBOX_RUNNER = Symbol('SandboxRunner');
