/**
 * evaluator.node 单元测试
 *
 * 聚焦于 runPreChecks 的关键决策路径：
 * - code_execution_failed → replan（不 retry）
 * - 结构性错误 → replan/fail（不 retry）
 * - 普通错误 → retry
 * - retry 超限 → replan
 * - replan 超限 → null（交给 LLM）
 */

// 直接引用模块内部 helper 函数的方式：通过导出公开接口间接测试
// evaluator 是纯函数调用链，行为通过最终返回的 Partial<AgentState>.evaluation 观察

import { evaluatorNode } from '@/agent/nodes/evaluator.node';
import type { AgentState, EvaluationResult } from '@/agent/agent.state';
import type { AgentCallbacks } from '@/agent/agent.callbacks';
import type { EventPublisher } from '@/event/event.publisher';
import { ChatOpenAI } from '@langchain/openai';

// ─── Mock ──────────────────────────────────────────────────────────────────────

function mockState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    taskId: 'task-1',
    runId: 'run-1',
    revisionInput: '测试任务',
    currentPlan: {
      planId: 'plan-1',
      steps: [
        {
          stepIndex: 0,
          description: '执行测试步骤',
          skillName: null,
          toolHint: 'sandbox_run_node',
        },
      ],
    },
    currentStepIndex: 0,
    stepResults: [],
    replanCount: 0,
    retryCount: 0,
    evaluation: null,
    executionOrder: 1,
    shouldStop: false,
    errorMessage: null,
    taskIntent: 'code_generation',
    taskIntentSubType: '',
    approvalMode: 'none',
    lastStepRunId: 'step-run-1',
    lastStepOutput: '',
    usedTokens: 0,
    tokenBudget: 100_000,
    ...overrides,
  };
}

function mockCallbacks(): jest.Mocked<AgentCallbacks> {
  return {
    savePlan: jest.fn(),
    createStepRun: jest.fn(),
    updateStepRun: jest.fn().mockResolvedValue(undefined),
    readCancelFlag: jest.fn().mockResolvedValue(false),
    setRunStatus: jest.fn().mockResolvedValue(undefined),
    saveArtifact: jest.fn(),
    getRecentMemory: jest.fn().mockResolvedValue(''),
    saveTokenUsage: jest.fn().mockResolvedValue(undefined),
    setRunAwaitingApproval: jest.fn().mockResolvedValue(undefined),
    finalize: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function mockLlm(): ChatOpenAI {
  return {
    withStructuredOutput: jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue({
        decision: 'continue',
        reason: 'mock',
      }),
    }),
  } as unknown as ChatOpenAI;
}

const mockPublisher = { emit: jest.fn() } as unknown as EventPublisher;

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('evaluatorNode — runPreChecks', () => {
  describe('code_execution_failed errorCode', () => {
    it('首次代码执行失败 → replan（不 retry）', async () => {
      const state = mockState({
        lastStepOutput:
          'error (code_execution_failed): exitCode=1\nstderr:\nSyntaxError: Unexpected token',
        retryCount: 0,
        replanCount: 0,
      });

      const result = await evaluatorNode(
        state,
        mockLlm(),
        mockCallbacks(),
        mockPublisher,
        'functionCalling',
        3,
        2,
      );

      const decision = (result.evaluation as EvaluationResult | null)?.decision;
      // code_execution_failed 应直接 replan，绕过 retry
      expect(decision).toBe('replan');
    });

    it('代码执行失败且 replanCount >= maxReplans → fail', async () => {
      const state = mockState({
        lastStepOutput:
          'error (code_execution_failed): exitCode=1\nstderr:\nReferenceError: x is not defined',
        replanCount: 2,
      });

      const result = await evaluatorNode(
        state,
        mockLlm(),
        mockCallbacks(),
        mockPublisher,
        'functionCalling',
        3,
        2, // maxReplans=2, replanCount=2 → 超限
      );

      expect((result.evaluation as EvaluationResult | null)?.decision).toBe(
        'fail',
      );
    });
  });

  describe('retry/replan 超限', () => {
    it('普通错误 retryCount < maxRetries → retry', async () => {
      const state = mockState({
        lastStepOutput: 'error (tool_execution_failed): 网络超时',
        retryCount: 0,
        replanCount: 0,
      });

      const result = await evaluatorNode(
        state,
        mockLlm(),
        mockCallbacks(),
        mockPublisher,
        'functionCalling',
        3,
        2,
      );

      expect((result.evaluation as EvaluationResult | null)?.decision).toBe(
        'retry',
      );
    });

    it('普通错误 retryCount >= maxRetries → replan', async () => {
      const state = mockState({
        lastStepOutput: 'error (tool_execution_failed): 连接超时',
        retryCount: 3, // 等于 maxRetries
        replanCount: 0,
      });

      const result = await evaluatorNode(
        state,
        mockLlm(),
        mockCallbacks(),
        mockPublisher,
        'functionCalling',
        3, // maxRetries=3
        2,
      );

      expect((result.evaluation as EvaluationResult | null)?.decision).toBe(
        'replan',
      );
    });
  });

  describe('取消检测', () => {
    it('cancel_requested=true → shouldStop=true, errorMessage=cancelled', async () => {
      const callbacks = mockCallbacks();
      callbacks.readCancelFlag.mockResolvedValue(true);

      const result = await evaluatorNode(
        mockState(),
        mockLlm(),
        callbacks,
        mockPublisher,
        'functionCalling',
      );

      expect(result.shouldStop).toBe(true);
      expect(result.errorMessage).toBe('cancelled');
    });
  });
});
