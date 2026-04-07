import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Tool } from '@/tool/interfaces/tool.interface';

@Injectable()
export class ToolRegistry implements OnModuleInit {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly tools = new Map<string, Tool>();

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
}
