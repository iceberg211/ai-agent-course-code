import { SkillRegistry } from '@/skill/skill.registry';
import { ToolRegistry } from '@/tool/tool.registry';

interface RawStep {
  stepIndex: number;
  description?: string;
  skillName?: string | null;
  skillInput?: unknown;
  toolHint?: string | null;
  toolInput?: unknown;
}

export interface PlanValidationError {
  stepIndex: number;
  field: string;
  message: string;
}

/**
 * Plan 语义校验。
 *
 * 校验规则：
 * 1. description 不能为空
 * 2. 每个 step 必须有且只有一个执行器：skillName 或 toolHint
 * 3. skillName 必须在 SkillRegistry 中已注册
 * 4. toolHint 必须在 ToolRegistry 中已注册
 * 5. skillInput / toolInput 通过对应 schema 的 safeParse 校验（不强制抛出，只收集错误）
 *
 * 注：task_id 字段允许为任意字符串，因为 Planner 会填入实际 UUID。
 */
export function validatePlanSemantics(
  steps: RawStep[],
  skillRegistry: SkillRegistry,
  toolRegistry: ToolRegistry,
): PlanValidationError[] {
  const errors: PlanValidationError[] = [];
  const seenStepIndexes = new Set<number>();

  if (steps.length === 0) {
    errors.push({
      stepIndex: -1,
      field: 'steps',
      message: '计划至少需要包含一个步骤',
    });
    return errors;
  }

  for (const [expectedIndex, step] of steps.entries()) {
    const idx = step.stepIndex;
    if (seenStepIndexes.has(idx)) {
      errors.push({
        stepIndex: idx,
        field: 'stepIndex',
        message: `stepIndex ${idx} 重复`,
      });
    }
    seenStepIndexes.add(idx);
    if (idx !== expectedIndex) {
      errors.push({
        stepIndex: idx,
        field: 'stepIndex',
        message: 'stepIndex 必须按数组顺序从 0 开始连续递增',
      });
    }
  }

  for (const step of steps) {
    const idx = step.stepIndex;

    if (!step.description || step.description.trim().length === 0) {
      errors.push({
        stepIndex: idx,
        field: 'description',
        message: 'description 不能为空',
      });
    }

    const hasSkill = Boolean(step.skillName && String(step.skillName).trim());
    const hasTool = Boolean(step.toolHint && String(step.toolHint).trim());

    if (!hasSkill && !hasTool) {
      errors.push({
        stepIndex: idx,
        field: 'executor',
        message: '步骤必须指定 skillName 或 toolHint 之一',
      });
      continue; // 无法继续校验其他字段
    }

    if (hasSkill && hasTool) {
      errors.push({
        stepIndex: idx,
        field: 'executor',
        message: '步骤不能同时指定 skillName 和 toolHint',
      });
      continue;
    }

    if (hasSkill) {
      const name = step.skillName!;
      if (!skillRegistry.has(name)) {
        const available = skillRegistry
          .getAll()
          .map((s) => s.name)
          .join(', ');
        errors.push({
          stepIndex: idx,
          field: 'skillName',
          message: `Skill "${name}" 未注册，可用：${available}`,
        });
      } else if (step.skillInput != null) {
        const skill = skillRegistry.get(name);
        const result = skill.inputSchema.safeParse(step.skillInput);
        if (!result.success) {
          const msg = result.error.issues.map((i) => i.message).join('; ');
          errors.push({
            stepIndex: idx,
            field: 'skillInput',
            message: `skillInput 不符合 ${name} 的输入 schema: ${msg}`,
          });
        }
      }
    }

    if (hasTool) {
      const name = step.toolHint!;
      if (!toolRegistry.has(name)) {
        const available = toolRegistry
          .getAll()
          .map((t) => t.name)
          .join(', ');
        errors.push({
          stepIndex: idx,
          field: 'toolHint',
          message: `Tool "${name}" 未注册，可用：${available}`,
        });
      } else if (step.toolInput != null) {
        const tool = toolRegistry.get(name);
        const result = tool.schema.safeParse(step.toolInput);
        if (!result.success) {
          const msg = result.error.issues.map((i) => i.message).join('; ');
          errors.push({
            stepIndex: idx,
            field: 'toolInput',
            message: `toolInput 不符合 ${name} 的输入 schema: ${msg}`,
          });
        }
      }
    }
  }

  return errors;
}

/**
 * 把校验错误列表格式化成 Planner 可读的提示字符串。
 */
export function formatValidationErrors(errors: PlanValidationError[]): string {
  return (
    '\n\n[语义校验失败，请修正以下问题后重新输出完整计划]\n' +
    errors
      .map((e) => `  步骤 ${e.stepIndex} [${e.field}]：${e.message}`)
      .join('\n')
  );
}
