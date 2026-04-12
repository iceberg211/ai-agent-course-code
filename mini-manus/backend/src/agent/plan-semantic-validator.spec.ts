import { z } from 'zod';
import {
  formatValidationErrors,
  validatePlanSemantics,
} from '@/agent/plan-semantic-validator';
import { SkillRegistry } from '@/skill/skill.registry';
import { ToolRegistry } from '@/tool/tool.registry';

function createRegistries() {
  const skillRegistry = {
    has: jest.fn((name: string) => name === 'web_research'),
    get: jest.fn(() => ({
      name: 'web_research',
      inputSchema: z.object({ query: z.string().min(1) }),
    })),
    getAll: jest.fn(() => [{ name: 'web_research' }]),
  } as unknown as SkillRegistry;

  const toolRegistry = {
    has: jest.fn((name: string) => name === 'web_search'),
    get: jest.fn(() => ({
      name: 'web_search',
      schema: z.object({ query: z.string().min(1) }),
    })),
    getAll: jest.fn(() => [{ name: 'web_search' }]),
  } as unknown as ToolRegistry;

  return { skillRegistry, toolRegistry };
}

describe('validatePlanSemantics', () => {
  it('接受有效的 skill 和 tool 步骤', () => {
    const { skillRegistry, toolRegistry } = createRegistries();

    const errors = validatePlanSemantics(
      [
        {
          stepIndex: 0,
          description: '搜索资料',
          toolHint: 'web_search',
          toolInput: { query: 'Mini-Manus' },
        },
        {
          stepIndex: 1,
          description: '整理摘要',
          skillName: 'web_research',
          skillInput: { query: 'Mini-Manus' },
        },
      ],
      skillRegistry,
      toolRegistry,
    );

    expect(errors).toEqual([]);
  });

  it('拒绝空计划', () => {
    const { skillRegistry, toolRegistry } = createRegistries();

    const errors = validatePlanSemantics([], skillRegistry, toolRegistry);

    expect(errors).toContainEqual({
      stepIndex: -1,
      field: 'steps',
      message: '计划至少需要包含一个步骤',
    });
  });

  it('拒绝重复、不连续或乱序的 stepIndex', () => {
    const { skillRegistry, toolRegistry } = createRegistries();

    const duplicateErrors = validatePlanSemantics(
      [
        {
          stepIndex: 0,
          description: '步骤一',
          toolHint: 'web_search',
          toolInput: { query: 'a' },
        },
        {
          stepIndex: 0,
          description: '步骤二',
          toolHint: 'web_search',
          toolInput: { query: 'b' },
        },
      ],
      skillRegistry,
      toolRegistry,
    );
    const gapErrors = validatePlanSemantics(
      [
        {
          stepIndex: 0,
          description: '步骤一',
          toolHint: 'web_search',
          toolInput: { query: 'a' },
        },
        {
          stepIndex: 2,
          description: '步骤三',
          toolHint: 'web_search',
          toolInput: { query: 'c' },
        },
      ],
      skillRegistry,
      toolRegistry,
    );
    const unorderedErrors = validatePlanSemantics(
      [
        {
          stepIndex: 1,
          description: '步骤二',
          toolHint: 'web_search',
          toolInput: { query: 'b' },
        },
        {
          stepIndex: 0,
          description: '步骤一',
          toolHint: 'web_search',
          toolInput: { query: 'a' },
        },
      ],
      skillRegistry,
      toolRegistry,
    );

    expect(duplicateErrors).toContainEqual({
      stepIndex: 0,
      field: 'stepIndex',
      message: 'stepIndex 0 重复',
    });
    expect(gapErrors).toContainEqual({
      stepIndex: 2,
      field: 'stepIndex',
      message: 'stepIndex 必须按数组顺序从 0 开始连续递增',
    });
    expect(unorderedErrors).toContainEqual({
      stepIndex: 1,
      field: 'stepIndex',
      message: 'stepIndex 必须按数组顺序从 0 开始连续递增',
    });
  });

  it('校验执行器唯一性和输入 schema', () => {
    const { skillRegistry, toolRegistry } = createRegistries();

    const errors = validatePlanSemantics(
      [
        {
          stepIndex: 0,
          description: '',
          skillName: 'web_research',
          toolHint: 'web_search',
          toolInput: { query: 'Mini-Manus' },
        },
        {
          stepIndex: 1,
          description: '搜索资料',
          toolHint: 'web_search',
          toolInput: { query: '' },
        },
      ],
      skillRegistry,
      toolRegistry,
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'description' }),
        expect.objectContaining({ field: 'executor' }),
        expect.objectContaining({ field: 'toolInput' }),
      ]),
    );
  });
});

describe('formatValidationErrors', () => {
  it('输出 Planner 可读的错误提示', () => {
    const message = formatValidationErrors([
      { stepIndex: 0, field: 'description', message: 'description 不能为空' },
    ]);

    expect(message).toContain('语义校验失败');
    expect(message).toContain('步骤 0 [description]：description 不能为空');
  });
});
