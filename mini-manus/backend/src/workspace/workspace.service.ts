import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);
  private readonly baseDir: string;

  constructor(private readonly config: ConfigService) {
    this.baseDir = config.get<string>(
      'WORKSPACE_BASE_DIR',
      '/tmp/mini-manus-workspaces',
    );
  }

  getTaskDir(taskId: string): string {
    return path.join(this.baseDir, taskId);
  }

  async ensureTaskDir(taskId: string): Promise<string> {
    const dir = this.getTaskDir(taskId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /** Resolves a relative path inside the task workspace. Throws if path escapes. */
  resolveSafePath(taskId: string, relativePath: string): string {
    const taskDir = this.getTaskDir(taskId);
    const resolved = path.resolve(taskDir, relativePath);
    if (!resolved.startsWith(taskDir + path.sep) && resolved !== taskDir) {
      throw new Error(
        `Path traversal detected: "${relativePath}" escapes workspace`,
      );
    }
    return resolved;
  }

  async cleanTaskDir(taskId: string): Promise<void> {
    const dir = this.getTaskDir(taskId);
    await fs.rm(dir, { recursive: true, force: true });
    this.logger.log(`Cleaned workspace for task ${taskId}`);
  }
}
