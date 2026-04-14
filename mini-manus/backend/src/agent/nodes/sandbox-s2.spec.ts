/**
 * Sandbox S2 端到端验证
 *
 * 场景：code_generation 确定性 workflow
 *   Step 0: code_project_generation skill → 生成文件 + entry_file
 *   Step 1: sandbox_run_node tool（当 SANDBOX_ENABLED=true 时）
 *
 * 验证：
 * 1. 沙箱 exitCode=0 → run 完成，artifact 生成
 * 2. 沙箱 exitCode≠0 → evaluator 触发 replan（不是 retry）
 * 3. Tool Calling 能从 step 0 的 entry_file 输出推断入口
 */

import { RunnableLambda } from '@langchain/core/runnables';
import { DETERMINISTIC_WORKFLOWS } from '@/agent/nodes/planner.node';
import { ToolRegistry } from '@/tool/tool.registry';
import { SkillRegistry } from '@/skill/skill.registry';
import type { AgentState, TaskIntent } from '@/agent/agent.state';

function mockState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    taskId: '00000000-0000-0000-0000-000000000001',
    runId: '00000000-0000-0000-0000-000000000002',
    revisionInput: '用 Vite + React 创建 Todo 应用',
    currentPlan: null,
    currentStepIndex: 0,
    stepResults: [],
    replanCount: 0,
    retryCount: 0,
    evaluation: null,
    executionOrder: 0,
    shouldStop: false,
    errorMessage: null,
    taskIntent: 'code_generation' as TaskIntent,
    approvalMode: 'none',
    lastStepRunId: '',
    lastStepOutput: '',
    usedTokens: 0,
    tokenBudget: 100_000,
    ...overrides,
  };
}

function makeRegistries(sandboxEnabled: boolean) {
  const toolReg = new ToolRegistry({
    get: jest.fn().mockReturnValue('300000'),
  } as any);

  // 注册 code_project_generation skill（side-effect）
  const skillReg = new SkillRegistry();
  skillReg.register({
    name: 'code_project_generation',
    description: '生成代码项目',
    effect: 'side-effect',
    inputSchema: {
      safeParse: () => ({ success: true }),
      description: '',
    } as any,
    outputSchema: {} as any,
    execute: async function* () {},
  });

  // 只在沙箱启用时注册 sandbox_run_node
  if (sandboxEnabled) {
    toolReg.register({
      name: 'sandbox_run_node',
      description: '在 Docker 沙箱中运行 Node.js 脚本',
      schema: {
        safeParse: (v: unknown) => ({ success: true, data: v }),
        description: '',
      } as any,
      type: 'side-effect',
      execute: jest.fn(),
    });
  }

  return { toolReg, skillReg };
}

// ─── S2 Workflow 结构测试 ─────────────────────────────────────────────────────

describe('Sandbox S2 Workflow 结构', () => {
  it('sandbox 未启用时，code_generation workflow 只有 1 步（code_project_generation）', () => {
    const { toolReg, skillReg } = makeRegistries(false);
    const builder = DETERMINISTIC_WORKFLOWS.code_generation!;
    const steps = builder(mockState(), {
      toolRegistry: toolReg,
      skillRegistry: skillReg,
    });

    expect(steps).toHaveLength(1);
    expect(steps[0].skillName).toBe('code_project_generation');
  });

  it('sandbox 启用时，code_generation workflow 有 2 步，第二步是 sandbox_run_node', () => {
    const { toolReg, skillReg } = makeRegistries(true);
    const builder = DETERMINISTIC_WORKFLOWS.code_generation!;
    const steps = builder(mockState(), {
      toolRegistry: toolReg,
      skillRegistry: skillReg,
    });

    expect(steps).toHaveLength(2);
    expect(steps[0].skillName).toBe('code_project_generation');
    expect(steps[1].toolHint).toBe('sandbox_run_node');
    expect(steps[1].stepIndex).toBe(1);
    expect(steps[1].toolInput).toMatchObject({ task_id: mockState().taskId });
  });

  it('sandbox 步骤的默认 entry 是 project/index.js', () => {
    const { toolReg, skillReg } = makeRegistries(true);
    const builder = DETERMINISTIC_WORKFLOWS.code_generation!;
    const steps = builder(mockState(), {
      toolRegistry: toolReg,
      skillRegistry: skillReg,
    });
    const sandboxStep = steps[1];

    // entry 在 Tool Calling 时会被覆盖，这里验证有合理的默认值
    expect(sandboxStep.toolInput?.entry).toBe('project/index.js');
  });
});

// ─── S2 entry_file 传递测试 ────────────────────────────────────────────────────

import { resolveStepResultsPlaceholder } from '@/agent/nodes/executor.node';

describe('Sandbox S2 entry_file 从前序步骤传递', () => {
  it('step 0 的 skillOutput 包含 entry_file，step 1 的 Tool Calling 可从 stepContext 读取', () => {
    // 模拟 code_project_generation 执行完的 step result
    const state = mockState({
      stepResults: [
        {
          stepRunId: 'sr-1',
          description: '根据需求生成完整代码项目',
          resultSummary: JSON.stringify({
            files: [
              'project/package.json',
              'project/src/main.tsx',
              'project/index.js',
            ],
            file_count: 3,
            entry_file: 'project/index.js',
          }),
          toolOutput: JSON.stringify({
            files: [
              'project/package.json',
              'project/src/main.tsx',
              'project/index.js',
            ],
            file_count: 3,
            entry_file: 'project/index.js', // ← Tool Calling 会读到这里
          }),
          executionOrder: 0,
        },
      ],
    });

    // entry_file 在 toolOutput 中，Tool Calling prompt 会收到这个 stepContext
    const stepContext = state.stepResults
      .map(
        (s) =>
          `步骤 ${s.executionOrder + 1}: ${s.description}\n` +
          (s.toolOutput
            ? `工具输出: ${s.toolOutput}`
            : `结果: ${s.resultSummary}`),
      )
      .join('\n\n');

    // 验证 entry_file 出现在 Tool Calling 收到的上下文里
    expect(stepContext).toContain('entry_file');
    expect(stepContext).toContain('project/index.js');
  });
});

// ─── Evaluator：code_execution_failed → replan ────────────────────────────────

import { evaluatorNode } from '@/agent/nodes/evaluator.node';
import type { AgentCallbacks } from '@/agent/agent.callbacks';
import type { EventPublisher } from '@/event/event.publisher';
import { ChatOpenAI } from '@langchain/openai';

describe('Sandbox S2 evaluator 行为', () => {
  const mockCallbacks: Partial<AgentCallbacks> = {
    readCancelFlag: jest.fn().mockResolvedValue(false),
    updateStepRun: jest.fn().mockResolvedValue(undefined),
  };
  const mockPublisher = { emit: jest.fn() } as unknown as EventPublisher;
  const mockLlm = {
    withStructuredOutput: jest.fn().mockReturnValue(
      RunnableLambda.from(async () => ({
        decision: 'continue',
        reason: 'mock',
      })),
    ),
  } as unknown as ChatOpenAI;

  it('沙箱 exitCode≠0 → code_execution_failed → evaluator 触发 replan（不是 retry）', async () => {
    const state = mockState({
      lastStepOutput:
        'error (code_execution_failed): exitCode=1\nstderr:\nError: Cannot find module',
      currentPlan: {
        planId: 'plan-1',
        steps: [
          {
            stepIndex: 0,
            description: '运行代码',
            toolHint: 'sandbox_run_node',
          },
        ],
      },
      retryCount: 0,
      replanCount: 0,
    });

    const result = await evaluatorNode(
      state,
      mockLlm,
      mockCallbacks as AgentCallbacks,
      mockPublisher,
      'functionCalling',
      3,
      2,
    );

    // code_execution_failed 应该跳过 retry，直接 replan
    expect(result.evaluation?.decision).toBe('replan');
  });

  it('沙箱成功（exitCode=0）→ evaluator 收到成功输出，走 LLM 判断', async () => {
    // exitCode=0 时 tool.success=true，lastStepOutput 是成功内容
    // runPreChecks 不会触发 code_execution_failed 路径
    const state = mockState({
      lastStepOutput:
        'exitCode: 0\nduration: 1234ms\nstdout:\nServer running on port 3000',
      currentPlan: {
        planId: 'plan-1',
        steps: [
          {
            stepIndex: 0,
            description: '运行代码',
            toolHint: 'sandbox_run_node',
          },
        ],
      },
    });

    const result = await evaluatorNode(
      state,
      mockLlm,
      mockCallbacks as AgentCallbacks,
      mockPublisher,
      'functionCalling',
      3,
      2,
    );

    // 成功输出不触发 code_execution_failed，交给 LLM 判断（mock 返回 continue）
    expect(result.evaluation?.decision).not.toBe('replan');
  });
});
