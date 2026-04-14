import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { tool as lcTool } from '@langchain/core/tools';
import {
  Tool,
  ToolResult,
  ToolRequirement,
} from '@/tool/interfaces/tool.interface';

interface CacheEntry {
  result: ToolResult;
  expiresAt: number;
}

@Injectable()
export class ToolRegistry implements OnModuleInit {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly tools = new Map<string, Tool>();
  private readonly toolCache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private availabilityChecker?: (req: ToolRequirement) => boolean;

  constructor(private readonly config: ConfigService) {
    this.cacheTtlMs = config.get<number>('TOOL_CACHE_TTL_MS', 5 * 60 * 1000);
  }

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
   * 设置运行时可用性检查器。
   * Planner 获取工具列表时，会过滤掉 requires 依赖不满足的工具。
   */
  setAvailabilityChecker(checker: (req: ToolRequirement) => boolean): void {
    this.availabilityChecker = checker;
  }

  /**
   * 返回 Planner 可见的工具列表——过滤掉运行时依赖不满足的工具。
   * 如果未设置 availabilityChecker，返回全部已注册工具。
   */
  getAvailableForPlanner(): Tool[] {
    if (!this.availabilityChecker) return this.getAll();
    return this.getAll().filter(
      (t) => !t.requires?.some((req) => !this.availabilityChecker!(req)),
    );
  }

  /**
   * 将 ToolRegistry 中的 Tool 转换为 LangChain DynamicStructuredTool，
   * 供 createReactAgent 等社区方案直接使用。
   *
   * @param name        工具名
   * @param injectArgs  注入参数（如 task_id），从暴露给 LLM 的 schema 中隐藏，调用时自动合并。
   *                    这样 SubAgent 的 LLM 不需要知道 task_id 等实现细节。
   */
  getAsLangChainTool(name: string, injectArgs?: Record<string, unknown>) {
    const t = this.get(name);
    const registry = this;

    // 从暴露给 LLM 的 schema 中移除注入字段，避免 LLM 填写实现细节
    let schema: z.ZodTypeAny = t.schema;
    if (injectArgs && Object.keys(injectArgs).length > 0) {
      try {
        const obj = t.schema as z.ZodObject<z.ZodRawShape>;
        const omitShape = Object.fromEntries(
          Object.keys(injectArgs).map((k) => [k, true as const]),
        ) as { [K in string]: true };
        schema = obj.omit(omitShape);
      } catch {
        // schema 不是 ZodObject（极少数情况），保持原样
      }
    }

    return lcTool(
      async (input: Record<string, unknown>) => {
        const merged = { ...(injectArgs ?? {}), ...input };
        const result = await registry.executeWithCache(name, merged);
        return result.success
          ? result.output
          : `Error (${result.errorCode ?? 'unknown'}): ${result.error}`;
      },
      {
        name: t.name,
        description: t.description,
        schema: schema as z.ZodObject<z.ZodRawShape>,
      },
    );
  }

  /**
   * 执行工具，read-only 工具自动缓存结果。
   * side-effect 工具（如 write_file）永不缓存，每次直接执行。
   */
  async executeWithCache(name: string, input: unknown): Promise<ToolResult> {
    const tool = this.get(name);

    if (tool.type === 'side-effect' || tool.cacheable === false) {
      const result = await tool.execute(input);
      return { ...result, cached: false };
    }

    const key = `${name}:${JSON.stringify(input)}`;
    const now = Date.now();
    const cached = this.toolCache.get(key);

    if (cached && cached.expiresAt > now) {
      this.logger.debug(`Cache hit: ${name}`);
      return { ...cached.result, cached: true };
    }

    const result = await tool.execute(input);
    const normalizedResult = { ...result, cached: false };
    // 只缓存成功结果，失败结果不缓存（下次重试应真正执行）
    if (normalizedResult.success) {
      this.toolCache.set(key, {
        result: normalizedResult,
        expiresAt: now + this.cacheTtlMs,
      });
    }
    return normalizedResult;
  }
}
