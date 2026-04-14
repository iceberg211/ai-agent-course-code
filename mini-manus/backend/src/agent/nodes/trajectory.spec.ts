/**
 * Trajectory / Golden Run 测试
 *
 * 目标：用固定 mock LLM 输出 + mock 回调，
 * 验证整个 Agent 图的执行轨迹（plan → step → evaluate → finalize）。
 *
 * 这类测试防止 prompt 或路由改动悄悄改变主链路行为。
 */

import { RunnableLambda } from '@langchain/core/runnables';
import { AgentService } from '@/agent/agent.service';
import { ConfigService } from '@nestjs/config';
import { ToolRegistry } from '@/tool/tool.registry';
import { SkillRegistry } from '@/skill/skill.registry';
import { WorkspaceService } from '@/workspace/workspace.service';
import { EventPublisher } from '@/event/event.publisher';
import { BrowserSessionService } from '@/browser/browser-session.service';
import type { AgentCallbacks } from '@/agent/agent.callbacks';
import { RunStatus, StepStatus } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';

// ─── 工厂函数 ─────────────────────────────────────────────────────────────────

function makeConfig(values: Record<string, unknown> = {}) {
  return {
    get: jest.fn(<T = unknown>(key: string, def?: T) => {
      const v = values[key];
      return (v === undefined ? def : v) as T;
    }),
  } as unknown as ConfigService;
}

function makeToolRegistry() {
  const reg = new ToolRegistry(makeConfig({ TOOL_CACHE_TTL_MS: '300000' }));
  // think 工具（无副作用，无外部依赖）
  reg.register({
    name: 'think',
    description: '内部推理',
    schema: { safeParse: (v: unknown) => ({ success: true, data: v }) } as any,
    type: 'read-only',
    execute: jest.fn().mockResolvedValue({
      success: true,
      output: '推理完成：已分析任务需求',
    }),
  });
  return reg;
}

function makeSkillRegistry() {
  return new SkillRegistry();
}

function makeCallbacks(): jest.Mocked<AgentCallbacks> {
  const savedPlan = {
    id: 'plan-1',
    steps: [
      {
        id: 'step-1',
        planId: 'plan-1',
        stepIndex: 0,
        description: '分析任务需求',
        toolHint: 'think',
        toolInput: { thought: '分析任务' },
      },
    ],
  };

  return {
    savePlan: jest.fn().mockResolvedValue(savedPlan),
    createStepRun: jest.fn().mockResolvedValue({
      id: 'step-run-1',
      planStepId: 'step-1',
    }),
    updateStepRun: jest.fn().mockResolvedValue(undefined),
    readCancelFlag: jest.fn().mockResolvedValue(false),
    setRunStatus: jest.fn().mockResolvedValue(undefined),
    saveArtifact: jest.fn().mockResolvedValue({ id: 'artifact-1', title: '任务报告' }),
    getRecentMemory: jest.fn().mockResolvedValue(''),
    saveTokenUsage: jest.fn().mockResolvedValue(undefined),
    saveLlmCallLogs: jest.fn().mockResolvedValue(undefined),
    setRunAwaitingApproval: jest.fn().mockResolvedValue(undefined),
    finalize: jest.fn().mockResolvedValue(undefined),
  } as any;
}

// ─── Mock LLM：固定输出 ────────────────────────────────────────────────────────
//
// LLM 调用顺序（general intent）：
//  1. routerNode   → withStructuredOutput(IntentSchema) → { intent, reason }
//  2. plannerNode  → withStructuredOutput(PlanSchema)   → { steps: [...] }
//  3. evaluatorNode→ withStructuredOutput(EvalSchema)   → { decision, reason }
//  4. finalizer    → llm.invoke(messages)               → { content: '...' }  (主产物，非 structured)
//  5. finalizer    → withStructuredOutput(JsonSchema)   → { summary, ... }

function makeMockLlm(
  planSteps: unknown[],
  evaluatorDecision: 'continue' | 'complete' | 'fail' = 'complete',
) {
  // withStructuredOutput 被调用 3 次：router、planner、finalizer-json
  // evaluator 也用 withStructuredOutput (第 3 次调用前 evaluator 先调)
  const structuredInvoke = jest.fn()
    .mockResolvedValueOnce({ intent: 'general', reason: 'general task' })           // 1. router
    .mockResolvedValueOnce({ steps: planSteps })                                     // 2. planner
    .mockResolvedValueOnce({ decision: evaluatorDecision, reason: 'mock eval' })     // 3. evaluator
    .mockResolvedValueOnce({ summary: '摘要', sources: [], key_points: ['要点'], artifact_type: 'markdown' }); // 4. finalizer JSON

  const withStructuredOutput = jest.fn().mockReturnValue(
    RunnableLambda.from(async () => structuredInvoke()),
  );

  // finalizer 主产物走 llm.invoke 直接调用（非 structured output）
  const directInvoke = jest.fn().mockResolvedValue({
    content: 'TYPE: markdown\n\n# 任务报告\n\n任务已完成。',
  });

  return { structuredInvoke, directInvoke, withStructuredOutput };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// LangGraph MemorySaver 会保持内部状态，导致进程不能立即退出
// 用 jest.useFakeTimers 确保 setTimeout/setInterval 不泄漏
beforeAll(() => { jest.useFakeTimers({ advanceTimers: true }); });
afterAll(() => { jest.useRealTimers(); jest.clearAllTimers(); });

describe('Trajectory: general intent → think step → complete', () => {
  let service: AgentService;
  let callbacks: jest.Mocked<AgentCallbacks>;
  let eventPublisher: { emit: jest.Mock };

  const PLAN_STEPS = [
    {
      stepIndex: 0,
      description: '分析任务需求',
      toolHint: 'think',
      toolInput: { thought: '分析任务需求' },
      skillName: null,
      skillInput: null,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    callbacks = makeCallbacks();
    eventPublisher = { emit: jest.fn() };

    const { withStructuredOutput, directInvoke } = makeMockLlm(PLAN_STEPS, 'complete');

    const config = makeConfig({
      OPENAI_API_KEY: 'test-key',
      MODEL_NAME: 'gpt-4o-mini',
      STRUCTURED_OUTPUT_METHOD: 'functionCalling',
      LLM_CACHE_ENABLED: 'false',
      MAX_RETRIES: 3,
      MAX_REPLANS: 2,
      MAX_STEPS: 20,
      STEP_TIMEOUT_MS: 30000,
      SKILL_TIMEOUT_MS: 60000,
      TOKEN_BUDGET: 100000,
      APPROVAL_TIMEOUT_MS: 600000,
    });

    service = new AgentService(
      config,
      makeToolRegistry(),
      makeSkillRegistry(),
      { getTaskDir: jest.fn().mockReturnValue('/tmp') } as unknown as WorkspaceService,
      eventPublisher as unknown as EventPublisher,
      { closeRun: jest.fn() } as unknown as BrowserSessionService,
    );

    // 替换 LLM 的 withStructuredOutput（处理 structured output 调用）
    (service.llm as any).withStructuredOutput = withStructuredOutput;
    // 替换 llm.invoke（finalizer 主产物走直接调用）
    (service.llm as any).invoke = directInvoke;
  });

  it('RUN_STARTED 事件在 executeRun 开始时发出', async () => {
    const signal = new AbortController().signal;
    await service.executeRun('task-1', 'run-1', '帮我分析这个任务', callbacks, signal);

    expect(eventPublisher.emit).toHaveBeenCalledWith(
      TASK_EVENTS.RUN_STARTED,
      expect.objectContaining({ taskId: 'task-1', runId: 'run-1' }),
    );
  });

  it('setRunStatus RUNNING 在 RUN_STARTED 后被调用', async () => {
    const signal = new AbortController().signal;
    await service.executeRun('task-1', 'run-1', '帮我分析这个任务', callbacks, signal);

    const calls = (callbacks.setRunStatus as jest.Mock).mock.calls;
    const runningCall = calls.find(([, status]) => status === RunStatus.RUNNING);
    expect(runningCall).toBeDefined();
  });

  it('savePlan 被调用，plan 包含 think 步骤', async () => {
    const signal = new AbortController().signal;
    await service.executeRun('task-1', 'run-1', '帮我分析这个任务', callbacks, signal);

    expect(callbacks.savePlan).toHaveBeenCalledWith(
      'run-1',
      expect.arrayContaining([
        expect.objectContaining({ stepIndex: 0, toolHint: 'think' }),
      ]),
    );
  });

  it('createStepRun 在 step 执行前被调用', async () => {
    const signal = new AbortController().signal;
    await service.executeRun('task-1', 'run-1', '帮我分析这个任务', callbacks, signal);

    expect(callbacks.createStepRun).toHaveBeenCalledWith(
      'run-1',
      expect.stringContaining('plan-1'),
      0,
    );
  });

  it('run 完成时 setRunStatus COMPLETED 被调用', async () => {
    const signal = new AbortController().signal;
    await service.executeRun('task-1', 'run-1', '帮我分析这个任务', callbacks, signal);

    const calls = (callbacks.setRunStatus as jest.Mock).mock.calls;
    const completedCall = calls.find(([, status]) => status === RunStatus.COMPLETED);
    expect(completedCall).toBeDefined();
  });

  it('finalize 在 run 结束后被调用（无论成功失败）', async () => {
    const signal = new AbortController().signal;
    await service.executeRun('task-1', 'run-1', '帮我分析这个任务', callbacks, signal);

    expect(callbacks.finalize).toHaveBeenCalledWith('task-1');
  });

  it('RUN_COMPLETED 事件在成功完成时发出', async () => {
    const signal = new AbortController().signal;
    await service.executeRun('task-1', 'run-1', '帮我分析这个任务', callbacks, signal);

    expect(eventPublisher.emit).toHaveBeenCalledWith(
      TASK_EVENTS.RUN_COMPLETED,
      expect.objectContaining({ taskId: 'task-1', runId: 'run-1' }),
    );
  });
});

describe('Trajectory: cancel mid-run', () => {
  it('取消信号触发后 shouldStop=true，run 标记 CANCELLED', async () => {
    const controller = new AbortController();
    const callbacks = makeCallbacks();
    const eventPublisher = { emit: jest.fn() };

    // cancel flag 在第一次读取后为 true（模拟用户点击取消）
    (callbacks.readCancelFlag as jest.Mock).mockResolvedValue(true);

    const config = makeConfig({
      OPENAI_API_KEY: 'test-key',
      MODEL_NAME: 'gpt-4o-mini',
      LLM_CACHE_ENABLED: 'false',
      STEP_TIMEOUT_MS: 30000,
      SKILL_TIMEOUT_MS: 60000,
      TOKEN_BUDGET: 100000,
      APPROVAL_TIMEOUT_MS: 600000,
    });

    const service = new AgentService(
      config,
      makeToolRegistry(),
      makeSkillRegistry(),
      { getTaskDir: jest.fn().mockReturnValue('/tmp') } as unknown as WorkspaceService,
      eventPublisher as unknown as EventPublisher,
      { closeRun: jest.fn() } as unknown as BrowserSessionService,
    );

    // Router → general, Planner → plan, Evaluator 时 cancel flag 已为 true
    const cancelInvoke = jest.fn()
      .mockResolvedValueOnce({ intent: 'general', reason: 'general' }) // router
      .mockResolvedValueOnce({
        steps: [{
          stepIndex: 0,
          description: '测试步骤',
          toolHint: 'think',
          toolInput: { thought: '分析' },
          skillName: null,
          skillInput: null,
        }],
      }); // planner
    ;(service.llm as any).withStructuredOutput = jest.fn().mockReturnValue(
      RunnableLambda.from(async () => cancelInvoke()),
    );
    ;(service.llm as any).invoke = jest.fn().mockResolvedValue({ content: '' });

    await service.executeRun('task-1', 'run-1', '取消测试', callbacks as any, controller.signal);

    // 取消后应标记 CANCELLED
    const calls = (callbacks.setRunStatus as jest.Mock).mock.calls;
    const cancelledCall = calls.find(([, status]) => status === RunStatus.CANCELLED);
    expect(cancelledCall).toBeDefined();

    expect(eventPublisher.emit).toHaveBeenCalledWith(
      TASK_EVENTS.RUN_CANCELLED,
      expect.objectContaining({ runId: 'run-1' }),
    );
  });
});
