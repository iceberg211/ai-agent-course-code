import { AgentState, TaskIntent, StepResult } from '@/agent/agent.state';
import {
  DETERMINISTIC_WORKFLOWS,
  STEP_RESULTS_PLACEHOLDER,
} from '@/agent/nodes/planner.node';
import { resolveStepResultsPlaceholder } from '@/agent/nodes/executor.node';

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
    approvalMode: 'none',
    lastStepRunId: '',
    lastStepOutput: '',
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

      const steps = builder(state);

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
      const steps = builder(mockState({ taskIntent: 'code_generation' }));

      steps.forEach((step, i) => {
        expect(step.stepIndex).toBe(i);
      });
    });
  });

  describe('research_report', () => {
    it('应返回固定计划：web_research → report_packaging', () => {
      const builder = DETERMINISTIC_WORKFLOWS.research_report!;
      const state = mockState({
        taskIntent: 'research_report',
        revisionInput: '调研 React 框架优缺点',
      });

      const steps = builder(state);

      expect(steps).toHaveLength(2);
      expect(steps[0].skillName).toBe('web_research');
      expect(steps[0].skillInput).toEqual({
        topic: state.revisionInput,
        depth: 2,
      });
      expect(steps[1].skillName).toBe('report_packaging');
      expect(steps[1].skillInput).toMatchObject({
        task_id: state.taskId,
        title: state.revisionInput,
      });
    });

    it('report_packaging 的 source_material 应使用占位符', () => {
      const builder = DETERMINISTIC_WORKFLOWS.research_report!;
      const steps = builder(mockState({ taskIntent: 'research_report' }));

      expect(
        (steps[1].skillInput as Record<string, unknown>).source_material,
      ).toBe(STEP_RESULTS_PLACEHOLDER);
    });
  });

  describe('不应有确定性 workflow 的意图', () => {
    it.each(['competitive_analysis', 'content_writing', 'general'] as const)(
      '%s 走 LLM Planner',
      (intent) => {
        expect(DETERMINISTIC_WORKFLOWS[intent]).toBeUndefined();
      },
    );
  });

  describe('通用校验', () => {
    it('所有确定性 workflow 的 step 都有 description', () => {
      const state = mockState();
      for (const [intent, builder] of Object.entries(
        DETERMINISTIC_WORKFLOWS,
      )) {
        const steps = builder!(
          mockState({ taskIntent: intent as TaskIntent }),
        );
        steps.forEach((step) => {
          expect(step.description).toBeTruthy();
        });
      }
    });

    it('所有确定性 workflow 只使用 skill（不使用裸 tool）', () => {
      const state = mockState();
      for (const [intent, builder] of Object.entries(
        DETERMINISTIC_WORKFLOWS,
      )) {
        const steps = builder!(
          mockState({ taskIntent: intent as TaskIntent }),
        );
        steps.forEach((step) => {
          expect(step.skillName).toBeTruthy();
          expect(step.toolHint).toBeFalsy();
        });
      }
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
    const result = resolveStepResultsPlaceholder(
      input,
      mockState(),
    );
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
