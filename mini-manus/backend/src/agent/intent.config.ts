import type { AgentState, PlanStepDef, TaskIntent } from '@/agent/agent.state';
import type { NodeContext } from '@/agent/agent.context';

/** Step results placeholder, resolved at runtime by executor */
export const STEP_RESULTS_PLACEHOLDER = '__STEP_RESULTS__';

export interface IntentConfig {
  /** Fixed workflow builder — if present, skip LLM planning */
  workflowBuilder?: (state: AgentState, ctx: NodeContext) => PlanStepDef[];
  /** Whether checker skips LLM evaluation (deterministic = pure rule-based) */
  deterministicCheck: boolean;
  /** Whether finalizer uses last step output directly as artifact body */
  useLastStepAsArtifact: boolean;
  /** Extra guidance injected into planner LLM prompt for this intent */
  plannerGuidance?: string;
}

export const INTENT_CONFIGS: Record<TaskIntent, IntentConfig> = {
  code_generation: {
    workflowBuilder: (state, ctx) => {
      const steps: PlanStepDef[] = [
        {
          stepIndex: 0,
          description: '根据需求生成完整代码项目',
          skillName: 'code_project_generation',
          skillInput: {
            task_id: state.taskId,
            project_description: state.userInput,
          },
        },
      ];
      if (ctx.toolRegistry.has('sandbox_run_node')) {
        steps.push({
          stepIndex: 1,
          description: '在沙箱中运行生成的代码，验证可执行性',
          toolHint: 'sandbox_run_node',
          toolInput: { task_id: state.taskId, entry: 'project/index.js' },
        });
      }
      return steps;
    },
    deterministicCheck: true,
    useLastStepAsArtifact: false,
    plannerGuidance: `【代码生成任务专用规划策略】
- 必须使用 code_project_generation skill 生成代码文件，禁止拆成多个 write_file step
- 如果 completedContext 中出现 code_execution_failed，使用 code_fix skill 修复`,
  },

  research_report: {
    workflowBuilder: (state) => [
      {
        stepIndex: 0,
        description: '围绕主题进行深度网络调研',
        subAgent: 'researcher',
        objective: `调研主题：${state.userInput}。\n\n请使用搜索和浏览工具从多角度收集信息，阅读 2-4 个高质量来源，综合整理核心发现、数据和结论，最终输出完整的调研报告。`,
      },
      {
        stepIndex: 1,
        description: '基于调研结果撰写并输出完整报告文件',
        subAgent: 'writer',
        objective: `报告主题：${state.userInput}。\n\n前序调研摘要：\n${STEP_RESULTS_PLACEHOLDER}\n\n请基于以上材料撰写完整的调研报告，保存为 task-report.md，同时导出 task-report.pdf。`,
      },
    ],
    deterministicCheck: true,
    useLastStepAsArtifact: true,
    plannerGuidance: `【调研报告任务专用规划策略】
- 推荐流程：researcher SubAgent（调研）→ writer SubAgent（撰写报告文件）`,
  },

  competitive_analysis: {
    workflowBuilder: (state) => [
      {
        stepIndex: 0,
        description: '对两个对比对象进行系统性调研',
        subAgent: 'researcher',
        objective: `对比调研：${state.userInput}。\n\n请系统搜索两个对比对象的官方文档、技术博客和第三方评测，重点收集架构设计、性能表现、集成能力、开发体验和成本模型等维度的数据。`,
      },
      {
        stepIndex: 1,
        description: '基于调研结果撰写并输出完整对比报告文件',
        subAgent: 'writer',
        objective: `对比报告主题：${state.userInput}。\n\n前序调研摘要：\n${STEP_RESULTS_PLACEHOLDER}\n\n请基于以上材料撰写结构完整的对比报告，保存为 comparison-report.md，同时导出 comparison-report.pdf。`,
      },
    ],
    deterministicCheck: true,
    useLastStepAsArtifact: true,
    plannerGuidance: `【对比分析任务专用规划策略】
- 推荐流程：researcher SubAgent（同时调研两个对比对象）→ writer SubAgent（撰写对比报告）`,
  },

  content_writing: {
    deterministicCheck: false,
    useLastStepAsArtifact: false,
    plannerGuidance: `【内容撰写任务专用规划策略】
- 优先使用 writer SubAgent 直接撰写内容
- 如果需要素材，先 researcher SubAgent 收集，再 writer SubAgent 撰写`,
  },

  general: {
    deterministicCheck: false,
    useLastStepAsArtifact: false,
  },
};

/** Get intent config, falling back to general for unknown intents */
export function getIntentConfig(intent: TaskIntent): IntentConfig {
  return INTENT_CONFIGS[intent] ?? INTENT_CONFIGS.general;
}
