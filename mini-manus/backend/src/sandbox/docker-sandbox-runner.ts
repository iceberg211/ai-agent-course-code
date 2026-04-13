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
  node:   'node:20-alpine',
  python: 'python:3.12-alpine',
};

const DEFAULT_MEMORY_LIMIT_MB = 256;
const DEFAULT_MAX_OUTPUT_LENGTH = 10_000;

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

    const taskWorkspacePath = path.join(this.workspaceBasePath, options.taskId);
    const memoryLimitBytes = (options.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB) * 1024 * 1024;
    const maxOutput = options.maxOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH;

    // 入口文件路径：容器内挂载到 /workspace
    const entryInContainer = `/workspace/${options.entryFile}`;

    const cmd =
      options.runtime === 'node'
        ? ['node', entryInContainer]
        : ['python', entryInContainer];

    const startMs = Date.now();
    let container: Dockerode.Container | null = null;

    try {
      // 1. 拉取镜像（如果本地不存在）
      await this.pullImageIfNeeded(image);

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
          ReadonlyRootfs: true,         // 只读根文件系统
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
      const waitResult = await Promise.race([
        container.wait(),
        this.timeoutPromise(options.timeoutMs, container),
      ]);

      const durationMs = Date.now() - startMs;

      // 5. 收集输出
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
      });

      const { stdout, stderr } = this.parseLogs(logs as Buffer, maxOutput);

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

  private async pullImageIfNeeded(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
    } catch {
      // 本地没有，拉取
      await new Promise<void>((resolve, reject) => {
        this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          this.docker.modem.followProgress(stream, (err2: Error | null) => {
            if (err2) reject(err2);
            else resolve();
          });
        });
      });
    }
  }

  private timeoutPromise(
    ms: number,
    container: Dockerode.Container,
  ): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(async () => {
        await container.kill().catch(() => undefined);
        reject(new Error('sandbox_timeout'));
      }, ms),
    );
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
