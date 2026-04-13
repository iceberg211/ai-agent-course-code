import * as path from 'path';
import Dockerode from 'dockerode';
import {
  SandboxRunner,
  SandboxRunOptions,
  SandboxRunResult,
} from '@/sandbox/sandbox-runner.interface';

/**
 * Docker 运行时镜像映射。
 * 课程版使用官方精简镜像，生产版可替换为预装了项目依赖的定制镜像。
 */
const RUNTIME_IMAGES: Record<string, string> = {
  node: 'node:20-alpine',
  python: 'python:3.12-alpine',
};

const DEFAULT_MEMORY_LIMIT_MB = 256;
const DEFAULT_MAX_OUTPUT_LENGTH = 10_000;
const DEFAULT_IMAGE_PULL_TIMEOUT_MS = 60_000;

/**
 * DockerSandboxRunner — S1 阶段的真实 Docker 实现。
 *
 * 安全策略（§8.6）：
 * - --network=none（networkMode: 'none'）
 * - --user=1000:1000（非 root）
 * - --cap-drop=ALL（无 Linux capability）
 * - --security-opt=no-new-privileges
 * - --pids-limit=100（防 fork bomb）
 * - --read-only rootfs（只有 /tmp 和挂载的 workspace 可写）
 * - 只挂载 task workspace，不挂载 Docker socket
 * - 超时后 docker kill（不只是进程 kill）
 */
export class DockerSandboxRunner implements SandboxRunner {
  private readonly docker: Dockerode;

  constructor(
    private readonly workspaceBasePath: string,
    socketPath = '/var/run/docker.sock',
  ) {
    this.docker = new Dockerode({ socketPath });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  async run(options: SandboxRunOptions): Promise<SandboxRunResult> {
    const image = RUNTIME_IMAGES[options.runtime];
    if (!image) {
      throw new Error(`sandbox_unsupported_runtime: ${options.runtime}`);
    }

    const taskWorkspacePath = this.resolveTaskWorkspacePath(options.taskId);
    const memoryLimitBytes =
      (options.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB) * 1024 * 1024;
    const maxOutput = options.maxOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH;
    const entryFile = this.normalizeEntryFile(options.entryFile);

    // 入口文件路径：容器内挂载到 /workspace
    const entryInContainer = path.posix.join('/workspace', entryFile);

    const cmd =
      options.runtime === 'node'
        ? ['node', entryInContainer]
        : ['python', entryInContainer];

    const startMs = Date.now();
    let container: Dockerode.Container | null = null;

    try {
      // 1. 拉取镜像（如果本地不存在）
      await this.pullImageIfNeeded(
        image,
        Math.min(options.timeoutMs, DEFAULT_IMAGE_PULL_TIMEOUT_MS),
      );

      // 2. 创建容器
      container = await this.docker.createContainer({
        Image: image,
        Cmd: cmd,
        User: '1000:1000',
        NetworkDisabled: options.networkDisabled !== false, // 默认禁网
        HostConfig: {
          Memory: memoryLimitBytes,
          MemorySwap: memoryLimitBytes, // 禁止 swap
          PidsLimit: 100,
          ReadonlyRootfs: true, // 只读根文件系统
          Tmpfs: { '/tmp': 'size=50m' },
          Binds: [`${taskWorkspacePath}:/workspace:ro`], // workspace 只读挂载
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges'],
          AutoRemove: false,
        },
      });

      // 3. 启动容器
      await container.start();

      // 4. 等待完成或超时
      const waitResult = await this.waitForContainer(
        container,
        options.timeoutMs,
      );

      const durationMs = Date.now() - startMs;

      // 5. 收集输出
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
      });

      const { stdout, stderr } = this.parseLogs(logs, maxOutput);

      return {
        stdout,
        stderr,
        exitCode: (waitResult as { StatusCode: number }).StatusCode ?? -1,
        durationMs,
        truncated: stdout.length >= maxOutput || stderr.length >= maxOutput,
      };
    } finally {
      if (container) {
        await container.remove({ force: true }).catch(() => undefined);
      }
    }
  }

  private resolveTaskWorkspacePath(taskId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
      throw new Error('sandbox_invalid_task_id');
    }

    const basePath = path.resolve(this.workspaceBasePath);
    const taskWorkspacePath = path.resolve(basePath, taskId);
    if (
      taskWorkspacePath !== basePath &&
      taskWorkspacePath.startsWith(`${basePath}${path.sep}`)
    ) {
      return taskWorkspacePath;
    }

    throw new Error('sandbox_invalid_task_id');
  }

  private normalizeEntryFile(entryFile: string): string {
    const raw = entryFile.trim();
    if (!raw) {
      throw new Error('sandbox_invalid_entry: entry 不能为空');
    }
    if (/[\0-\x1f]/.test(raw)) {
      throw new Error('sandbox_invalid_entry: entry 包含非法控制字符');
    }
    if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) {
      throw new Error('sandbox_invalid_entry: entry 必须是相对路径');
    }

    const normalizedSlashes = raw.replace(/\\/g, '/');
    const segments = normalizedSlashes.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new Error('sandbox_invalid_entry: entry 包含非法路径片段');
    }

    const normalized = path.posix.normalize(normalizedSlashes);
    if (
      normalized === '.' ||
      normalized === '..' ||
      normalized.startsWith('../') ||
      normalized.endsWith('/')
    ) {
      throw new Error('sandbox_invalid_entry: entry 必须指向 workspace 内文件');
    }

    return normalized;
  }

  private async pullImageIfNeeded(
    image: string,
    timeoutMs: number,
  ): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
    } catch {
      // 本地没有，拉取；首次拉镜像必须有上限，避免 Agent step 长时间卡住。
      try {
        await this.withTimeout(
          new Promise<void>((resolve, reject) => {
            this.docker.pull(
              image,
              (err: Error | null, stream: NodeJS.ReadableStream) => {
                if (err) return reject(err);
                this.docker.modem.followProgress(
                  stream,
                  (err2: Error | null) => {
                    if (err2) reject(err2);
                    else resolve();
                  },
                );
              },
            );
          }),
          timeoutMs,
          `sandbox_image_unavailable: 拉取镜像 ${image} 超时`,
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`sandbox_image_unavailable: ${detail}`);
      }
    }
  }

  private async waitForContainer(
    container: Dockerode.Container,
    timeoutMs: number,
  ): Promise<unknown> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        container.wait(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(async () => {
            await container.kill().catch(() => undefined);
            reject(new Error('sandbox_timeout'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(timeoutMessage));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Docker logs stream 包含 8 字节头：[stream_type(1), 0,0,0, size(4)]
   * 需要手动解析 multiplexed stream。
   */
  private parseLogs(
    buf: Buffer,
    maxLength: number,
  ): { stdout: string; stderr: string } {
    let stdout = '';
    let stderr = '';
    let offset = 0;

    while (offset + 8 <= buf.length) {
      const streamType = buf[offset];
      const size = buf.readUInt32BE(offset + 4);
      offset += 8;

      if (offset + size > buf.length) break;
      const chunk = buf.subarray(offset, offset + size).toString('utf8');
      offset += size;

      if (streamType === 1) stdout += chunk;
      else if (streamType === 2) stderr += chunk;
    }

    return {
      stdout: stdout.slice(0, maxLength),
      stderr: stderr.slice(0, maxLength),
    };
  }
}
