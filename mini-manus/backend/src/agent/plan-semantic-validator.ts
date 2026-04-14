import { SkillRegistry } from '@/skill/skill.registry';
import { ToolRegistry } from '@/tool/tool.registry';

interface RawStep {
  stepIndex: number;
  description?: string;
  skillName?: string | null;
  skillInput?: unknown;
  toolHint?: string | null;
  toolInput?: unknown;
  subAgent?: string | null;
  objective?: string | null;
}

export interface PlanValidationError {
  stepIndex: number;
  field: string;
  message: string;
}

export interface PlanSemanticValidationOptions {
  maxSteps?: number;
  allowedSideEffectTools?: string[];
  allowedSideEffectSkills?: string[];
}

function toNameSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.trim()).filter(Boolean));
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
  options: PlanSemanticValidationOptions = {},
): PlanValidationError[] {
  const errors: PlanValidationError[] = [];
  const seenStepIndexes = new Set<number>();
  const allowedSideEffectTools = toNameSet(options.allowedSideEffectTools);
  const allowedSideEffectSkills = toNameSet(options.allowedSideEffectSkills);

  if (steps.length === 0) {
    errors.push({
      stepIndex: -1,
      field: 'steps',
      message: '计划至少需要包含一个步骤',
    });
    return errors;
  }

  if (options.maxSteps != null && steps.length > options.maxSteps) {
    errors.push({
      stepIndex: -1,
      field: 'steps',
      message: `计划步骤数不能超过 ${options.maxSteps}`,
    });
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
    const hasSubAgent = Boolean(step.subAgent && String(step.subAgent).trim());

    if (!hasSkill && !hasTool && !hasSubAgent) {
      errors.push({
        stepIndex: idx,
        field: 'executor',
        message: '步骤必须指定 skillName、toolHint 或 subAgent 之一',
      });
      continue; // 无法继续校验其他字段
    }

    // SubAgent 步骤：无需进一步校验 skill/tool，直接跳过
    if (hasSubAgent) continue;

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
        if (
          skill.effect === 'side-effect' &&
          !allowedSideEffectSkills.has(name)
        ) {
          errors.push({
            stepIndex: idx,
            field: 'skillName',
            message: `Side-effect Skill "${name}" 未在 PLANNER_ALLOWED_SIDE_EFFECT_SKILLS 中启用`,
          });
        }
        const result = skill.inputSchema.safeParse(step.skillInput);
        if (!result.success) {
          const msg = result.error.issues.map((i) => i.message).join('; ');
          errors.push({
            stepIndex: idx,
            field: 'skillInput',
            message: `skillInput 不符合 ${name} 的输入 schema: ${msg}`,
          });
        }
      } else {
        const skill = skillRegistry.get(name);
        if (
          skill.effect === 'side-effect' &&
          !allowedSideEffectSkills.has(name)
        ) {
          errors.push({
            stepIndex: idx,
            field: 'skillName',
            message: `Side-effect Skill "${name}" 未在 PLANNER_ALLOWED_SIDE_EFFECT_SKILLS 中启用`,
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
        if (tool.type === 'side-effect' && !allowedSideEffectTools.has(name)) {
          errors.push({
            stepIndex: idx,
            field: 'toolHint',
            message: `Side-effect Tool "${name}" 未在 PLANNER_ALLOWED_SIDE_EFFECT_TOOLS 中启用`,
          });
        }
        const result = tool.schema.safeParse(step.toolInput);
        if (!result.success) {
          const msg = result.error.issues.map((i) => i.message).join('; ');
          errors.push({
            stepIndex: idx,
            field: 'toolInput',
            message: `toolInput 不符合 ${name} 的输入 schema: ${msg}`,
          });
        }
      } else {
        const tool = toolRegistry.get(name);
        if (tool.type === 'side-effect' && !allowedSideEffectTools.has(name)) {
          errors.push({
            stepIndex: idx,
            field: 'toolHint',
            message: `Side-effect Tool "${name}" 未在 PLANNER_ALLOWED_SIDE_EFFECT_TOOLS 中启用`,
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
