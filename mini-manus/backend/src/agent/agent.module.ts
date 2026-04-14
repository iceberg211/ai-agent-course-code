import { Module, OnModuleInit } from '@nestjs/common';
import { AgentService } from '@/agent/agent.service';
import { ToolModule } from '@/tool/tool.module';
import { SkillModule } from '@/skill/skill.module';
import { WorkspaceModule } from '@/workspace/workspace.module';
import { EventModule } from '@/event/event.module';
import { BrowserModule } from '@/browser/browser.module';
import { SubAgentRegistry, type SubAgentDef } from '@/agent/subagents/subagent.registry';

// ─── Built-in SubAgent definitions ──────────────────────────────────────────
// Previously in subagents/react-subagent.ts, moved here for simplicity.
// Register via SubAgentRegistry in onModuleInit.

const RESEARCHER_DEF: SubAgentDef = {
  tools: ['think', 'web_search', 'fetch_url_as_markdown', 'browse_url'],
  isSideEffect: false,
  systemPrompt: `你是一个专业的深度调研 Agent。

**工作职责**：根据用户指定的调研主题，使用搜索和浏览工具系统收集高质量信息，最终输出结构清晰的调研报告。

**工作流程**：
1. 分析调研主题，识别核心问题和关键词
2. 使用 web_search 从多个角度搜索信息（至少 2-3 次不同关键词）
3. 使用 fetch_url_as_markdown 阅读最相关的来源页面（选 2-4 个高质量来源）
4. 使用 think 整理发现、识别模式、补充分析
5. 最终输出完整调研报告

**输出要求**：调研报告必须包含核心发现、数据支撑、关键来源（URL 列表）、结论与建议。格式清晰、内容翔实。`,
};

const WRITER_DEF: SubAgentDef = {
  tools: ['think', 'read_file', 'list_directory', 'write_file', 'export_pdf'],
  injectArgs: (taskId) => ({ task_id: taskId }),
  isSideEffect: true,
  systemPrompt: `你是一个专业的文档撰写 Agent。

**工作职责**：根据提供的材料和写作目标，撰写高质量的正式文档并保存为文件。

**工作流程**：
1. 仔细阅读材料和目标要求
2. 使用 think 规划文档结构（目录、章节、重点）
3. 撰写完整的 Markdown 报告内容
4. 使用 write_file 将报告保存（路径示例：task-report.md）
5. 如可用，使用 export_pdf 导出 PDF 版本（路径：task-report.pdf）

**输出要求**：报告结构清晰（有目录/章节）、内容完整、有数据支撑、有结论建议。Markdown 格式。`,
};

@Module({
  imports: [ToolModule, SkillModule, WorkspaceModule, EventModule, BrowserModule],
  providers: [AgentService, SubAgentRegistry],
  exports: [AgentService],
})
export class AgentModule implements OnModuleInit {
  constructor(private readonly subAgentRegistry: SubAgentRegistry) {}

  onModuleInit() {
    this.subAgentRegistry.register('researcher', RESEARCHER_DEF);
    this.subAgentRegistry.register('writer', WRITER_DEF);
  }
}
