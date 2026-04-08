import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Tool, ToolResult } from '@/tool/interfaces/tool.interface';

interface CacheEntry {
  result: ToolResult;
  expiresAt: number;
}

@Injectable()
export class ToolRegistry implements OnModuleInit {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly tools = new Map<string, Tool>();

  /** read-only 工具结果缓存，key = "toolName:JSON(input)"，TTL 5 分钟 */
  private readonly toolCache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  onModuleInit() {
    this.logger.log(`ToolRegistry initialized with ${this.tools.size} tools`);
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
    this.logger.debug(`Registered tool: ${tool.name}`);
  }

  get(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool;
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Returns descriptions for executor prompt injection */
  getDescriptions(): string {
    return this.getAll()
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');
  }

  /**
   * 执行工具，read-only 工具自动缓存结果。
   * side-effect 工具（如 write_file）永不缓存，每次直接执行。
   */
  async executeWithCache(name: string, input: unknown): Promise<ToolResult> {
    const tool = this.get(name);

    if (tool.type === 'side-effect') {
      return tool.execute(input);
    }

    const key = `${name}:${JSON.stringify(input)}`;
    const now = Date.now();
    const cached = this.toolCache.get(key);

    if (cached && cached.expiresAt > now) {
      this.logger.debug(`Cache hit: ${name}`);
      return cached.result;
    }

    const result = await tool.execute(input);
    // 只缓存成功结果，失败结果不缓存（下次重试应真正执行）
    if (result.success) {
      this.toolCache.set(key, { result, expiresAt: now + this.CACHE_TTL_MS });
    }
    return result;
  }
}
