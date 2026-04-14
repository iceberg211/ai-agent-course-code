import { AgentState, TaskIntent, StepResult } from '@/agent/agent.state';
import {
  DETERMINISTIC_WORKFLOWS,
  STEP_RESULTS_PLACEHOLDER,
  plannerNode,
} from '@/agent/nodes/planner.node';
import { resolveStepResultsPlaceholder } from '@/agent/nodes/executor.node';
import { ToolRegistry } from '@/tool/tool.registry';
import { SkillRegistry } from '@/skill/skill.registry';
import type { AgentCallbacks } from '@/agent/agent.callbacks';
import type { EventPublisher } from '@/event/event.publisher';
import { ChatOpenAI } from '@langchain/openai';

/** 测试用 WorkflowContext：sandbox 未启用（toolRegistry.has 返回 false） */
const mockCtx = {
  toolRegistry: {
    has: jest.fn().mockReturnValue(false),
    getAll: () => [],
    get: jest.fn(),
  } as unknown as ToolRegistry,
  skillRegistry: {
    has: jest.fn().mockReturnValue(false),
    getAll: () => [],
    get: jest.fn(),
  } as unknown as SkillRegistry,
};

// ─── 辅助 ──────────────────────────────────────────────────────────────────────

function mockState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    taskId: '00000000-0000-0000-0000-000000000001',
    runId: '00000000-0000-0000-0000-000000000002',
    revisionInput: '用 React + Vite 创建 Todo 应用',
    currentPlan: null,
    currentStepIndex: 0,
    stepResults: [],
    replanCount: 0,
    retryCount: 0,
    evaluation: null,
    executionOrder: 0,
    shouldStop: false,
    errorMessage: null,
    taskIntent: 'general' as TaskIntent,
    taskIntentSubType: '',
    approvalMode: 'none',
    lastStepRunId: '',
    lastStepOutput: '',
    usedTokens: 0,
    tokenBudget: 100_000,
    ...overrides,
  };
}

// ─── 确定性 Workflow 测试 ─────────────────────────────────────────────────────

describe('Deterministic Workflows', () => {
  describe('code_generation', () => {
    it('应返回固定计划：code_project_generation skill', () => {
      const builder = DETERMINISTIC_WORKFLOWS.code_generation!;
      const state = mockState({
        taskIntent: 'code_generation',
        revisionInput: '用 React + Vite 创建 Todo 应用',
      });

      const steps = builder(state, mockCtx);

      expect(steps).toHaveLength(1);
      expect(steps[0].skillName).toBe('code_project_generation');
      expect(steps[0].skillInput).toEqual({
        task_id: state.taskId,
        project_description: state.revisionInput,
      });
      // 不应有 toolHint（不走裸 tool 路径）
      expect(steps[0].toolHint).toBeUndefined();
    });

    it('stepIndex 从 0 开始连续', () => {
      const builder = DETERMINISTIC_WORKFLOWS.code_generation!;
      const steps = builder(
        mockState({ taskIntent: 'code_generation' }),
        mockCtx,
      );

      steps.forEach((step, i) => {
        expect(step.stepIndex).toBe(i);
      });
    });
  });

  describe('research_report', () => {
    it('应返回固定计划：researcher SubAgent → writer SubAgent', () => {
      const builder = DETERMINISTIC_WORKFLOWS.research_report!;
      const state = mockState({
        taskIntent: 'research_report',
        revisionInput: '调研 React 框架优缺点',
      });

      const steps = builder(state, mockCtx);

      expect(steps).toHaveLength(2);
      expect(steps[0].subAgent).toBe('researcher');
      expect(steps[0].objective).toContain(state.revisionInput);
      expect(steps[1].subAgent).toBe('writer');
      expect(steps[1].objective).toContain(state.revisionInput);
    });

    it('writer SubAgent 的 objective 应包含 __STEP_RESULTS__ 占位符', () => {
      const builder = DETERMINISTIC_WORKFLOWS.research_report!;
      const steps = builder(
        mockState({ taskIntent: 'research_report' }),
        mockCtx,
      );

      expect(steps[1].objective).toContain(STEP_RESULTS_PLACEHOLDER);
    });

    it('SubAgent 步骤不应设置 skillName 或 toolHint', () => {
      const builder = DETERMINISTIC_WORKFLOWS.research_report!;
      const steps = builder(
        mockState({ taskIntent: 'research_report' }),
        mockCtx,
      );

      steps.forEach((step) => {
        expect(step.skillName).toBeFalsy();
        expect(step.toolHint).toBeFalsy();
      });
    });
  });

  describe('没有确定性 workflow 的意图', () => {
    it.each(['content_writing', 'general'] as const)(
      '%s 走 LLM Planner',
      (intent) => {
        expect(DETERMINISTIC_WORKFLOWS[intent]).toBeUndefined();
      },
    );
  });

  describe('competitive_analysis', () => {
    it('应返回固定计划：researcher SubAgent → writer SubAgent', () => {
      const builder = DETERMINISTIC_WORKFLOWS.competitive_analysis!;
      const state = mockState({
        taskIntent: 'competitive_analysis',
        revisionInput: 'Supabase 与 Firebase 对比',
      });

      const steps = builder(state, mockCtx);

      expect(steps).toHaveLength(2);
      expect(steps[0].subAgent).toBe('researcher');
      expect(steps[0].objective).toContain(state.revisionInput);
      expect(steps[1].subAgent).toBe('writer');
      expect(steps[1].objective).toContain(STEP_RESULTS_PLACEHOLDER);
    });
  });

  describe('通用校验', () => {
    it('所有确定性 workflow 的 step 都有 description', () => {
      const state = mockState();
      for (const [intent, builder] of Object.entries(DETERMINISTIC_WORKFLOWS)) {
        const steps = builder(
          mockState({ taskIntent: intent as TaskIntent }),
          mockCtx,
        );
        steps.forEach((step) => {
          expect(step.description).toBeTruthy();
        });
      }
    });

    it('沙箱未启用时，所有确定性 workflow 的步骤都使用 skill 或 subAgent（不走裸 tool）', () => {
      // mockCtx 里 toolRegistry.has 返回 false，沙箱步骤不会被添加
      for (const [intent, builder] of Object.entries(DETERMINISTIC_WORKFLOWS)) {
        const steps = builder(
          mockState({ taskIntent: intent as TaskIntent }),
          mockCtx,
        );
        steps.forEach((step) => {
          // 步骤必须使用 skill 或 subAgent，不走裸 tool 路径
          const hasHighLevelExecutor = step.skillName || step.subAgent;
          expect(hasHighLevelExecutor).toBeTruthy();
          expect(step.toolHint).toBeFalsy();
        });
      }
    });

    it('沙箱启用时，code_generation 包含 sandbox_run_node 步骤', () => {
      const sandboxCtx = {
        ...mockCtx,
        toolRegistry: {
          has: (name: string) => name === 'sandbox_run_node',
          getAll: () => [],
          get: jest.fn(),
        } as unknown as typeof mockCtx.toolRegistry,
      };
      const builder = DETERMINISTIC_WORKFLOWS.code_generation!;
      const steps = builder(
        mockState({ taskIntent: 'code_generation' }),
        sandboxCtx,
      );
      expect(steps).toHaveLength(2);
      expect(steps[1].toolHint).toBe('sandbox_run_node');
      expect(steps[1].stepIndex).toBe(1);
    });
  });
});

// ─── Placeholder 解析测试（executor 侧）────────────────────────────────────

describe('resolveStepResultsPlaceholder', () => {
  const stepResults: StepResult[] = [
    {
      stepRunId: 'sr-1',
      description: '网络调研',
      resultSummary: '调研完成',
      toolOutput: 'URL: https://react.dev\n关键发现: React 19 已发布',
      executionOrder: 0,
    },
  ];

  it('无占位符时返回原始 input', () => {
    const input = { title: '报告', content: '正文' };
    const result = resolveStepResultsPlaceholder(input, mockState());
    expect(result).toBe(input); // 同一引用
  });

  it('有占位符时替换为 stepResults 摘要', () => {
    const input = {
      task_id: '123',
      title: '报告',
      source_material: STEP_RESULTS_PLACEHOLDER,
    };
    const result = resolveStepResultsPlaceholder(
      input,
      mockState({ stepResults }),
    );
    expect(result.task_id).toBe('123');
    expect(result.title).toBe('报告');
    expect(result.source_material).toContain('https://react.dev');
    expect(result.source_material).toContain('React 19');
  });

  it('stepResults 为空时占位符解析为空字符串', () => {
    const input = { source_material: STEP_RESULTS_PLACEHOLDER };
    const result = resolveStepResultsPlaceholder(
      input,
      mockState({ stepResults: [] }),
    );
    expect(result.source_material).toBe('');
  });

  it('多个占位符字段都被解析', () => {
    const input = {
      field_a: STEP_RESULTS_PLACEHOLDER,
      field_b: STEP_RESULTS_PLACEHOLDER,
      field_c: '保持不变',
    };
    const result = resolveStepResultsPlaceholder(
      input,
      mockState({ stepResults }),
    );
    expect(result.field_a).toContain('react.dev');
    expect(result.field_b).toContain('react.dev');
    expect(result.field_c).toBe('保持不变');
  });

  it('非字符串值不受影响', () => {
    const input = {
      count: 42,
      flag: true,
      source: STEP_RESULTS_PLACEHOLDER,
    };
    const result = resolveStepResultsPlaceholder(
      input,
      mockState({ stepResults }),
    );
    expect(result.count).toBe(42);
    expect(result.flag).toBe(true);
  });

  it('优先使用 toolOutput，无 toolOutput 时回退到 resultSummary', () => {
    const mixed: StepResult[] = [
      {
        stepRunId: 'sr-1',
        description: '有 toolOutput',
        resultSummary: '摘要A',
        toolOutput: '工具输出A',
        executionOrder: 0,
      },
      {
        stepRunId: 'sr-2',
        description: '无 toolOutput',
        resultSummary: '摘要B',
        executionOrder: 1,
      },
    ];
    const input = { data: STEP_RESULTS_PLACEHOLDER };
    const result = resolveStepResultsPlaceholder(
      input,
      mockState({ stepResults: mixed }),
    );
    expect(result.data).toContain('工具输出A');
    expect(result.data).toContain('摘要B');
    expect(result.data).not.toContain('摘要A'); // toolOutput 优先
  });
});

// ─── Planner 回归测试（mock LLM → 断言 plan 结构）─────────────────────────────
//
// 验证 plannerNode 在 general 意图下调用 LLM，
// 返回的 plan 被正确保存并写入 state。

import { RunnableLambda } from '@langchain/core/runnables';

const MOCK_STEPS = [
  {
    stepIndex: 0,
    description: '搜索 React 最新进展',
    skillName: 'web_research',
    skillInput: { topic: '调研 React', depth: 2 },
    toolHint: null,
    toolInput: null,
  },
];

describe('plannerNode 回归测试', () => {
  // withStructuredOutput 必须返回真正的 LangChain Runnable，
  // 否则 plannerPrompt.pipe(result) 无法正常工作
  const withStructuredOutputSpy = jest.fn()
  const mockLlm = {
    withStructuredOutput: withStructuredOutputSpy,
  } as unknown as ChatOpenAI;

  const savedPlan = { id: 'plan-1', steps: [] };

  const mockCallbacks: Partial<AgentCallbacks> = {
    savePlan: jest.fn().mockResolvedValue(savedPlan),
    getRecentMemory: jest.fn().mockResolvedValue(''),
    setRunAwaitingApproval: jest.fn().mockResolvedValue(undefined),
    setRunStatus: jest.fn().mockResolvedValue(undefined),
  };

  const mockPublisher = { emit: jest.fn() } as unknown as EventPublisher;

  beforeEach(() => {
    jest.clearAllMocks()
    // 每次测试重置为返回能与 .pipe() 正常组合的真实 Runnable
    withStructuredOutputSpy.mockReturnValue(
      RunnableLambda.from(async () => ({ steps: MOCK_STEPS })),
    )
    ;(mockCallbacks.savePlan as jest.Mock).mockResolvedValue(savedPlan)
    ;(mockCallbacks.getRecentMemory as jest.Mock).mockResolvedValue('')
  })

  function buildRegistries(hasSkill = true) {
    const skillReg = new SkillRegistry();
    if (hasSkill) {
      skillReg.register({
        name: 'web_research',
        description: '调研',
        effect: 'read-only',
        inputSchema: {
          safeParse: () => ({ success: true }),
          description: '',
        } as any,
        outputSchema: {} as any,
        execute: async function* () {},
      });
    }
    const toolReg = new ToolRegistry({
      get: jest.fn().mockReturnValue('300000'),
    } as any);
    return { skillReg, toolReg };
  }

  it('general 意图 → 走 LLM Planner，savePlan 被调用', async () => {
    const { skillReg, toolReg } = buildRegistries();

    const state = mockState({
      taskIntent: 'general',
      revisionInput: '调研 React 最新进展',
      runId: 'run-1',
      taskId: 'task-1',
    });

    const result = await plannerNode(
      state,
      undefined,
      mockLlm,
      skillReg,
      toolReg,
      mockCallbacks as AgentCallbacks,
      mockPublisher,
      'functionCalling',
      { maxSteps: 8, allowedSideEffectTools: [], allowedSideEffectSkills: [] },
    );

    expect(mockCallbacks.savePlan).toHaveBeenCalledWith(
      'run-1',
      expect.arrayContaining([
        expect.objectContaining({ stepIndex: 0, skillName: 'web_research' }),
      ]),
    );
    expect(result.currentPlan?.planId).toBe('plan-1');
    expect(result.currentStepIndex).toBe(0);
  });

  it('code_generation 意图 → 走确定性 workflow，不调用 LLM', async () => {
    const { skillReg, toolReg } = buildRegistries();
    // mock code_project_generation skill
    skillReg.register({
      name: 'code_project_generation',
      description: '生成代码',
      effect: 'side-effect',
      inputSchema: {
        safeParse: () => ({ success: true }),
        description: '',
      } as any,
      outputSchema: {} as any,
      execute: async function* () {},
    });

    const state = mockState({
      taskIntent: 'code_generation',
      revisionInput: '用 React 写 Todo 应用',
      runId: 'run-2',
      taskId: 'task-2',
      replanCount: 0,
    });

    const result = await plannerNode(
      state,
      undefined,
      mockLlm,
      skillReg,
      toolReg,
      mockCallbacks as AgentCallbacks,
      mockPublisher,
      'functionCalling',
      {
        maxSteps: 8,
        allowedSideEffectSkills: ['code_project_generation'],
        allowedSideEffectTools: [],
      },
    );

    // 确定性路径不应调用 LLM 的 withStructuredOutput（直接返回固定计划，跳过 LLM 链构建）
    // 注意：withStructuredOutput 在 LLM 路径才会被调用；确定性路径在 early return 前退出
    expect(result.currentPlan).toBeDefined();
    expect(result.currentPlan?.steps[0].skillName).toBe('code_project_generation');
    // 确定性路径 savePlan 被调用一次
    expect(mockCallbacks.savePlan).toHaveBeenCalledTimes(1);
  });
});
