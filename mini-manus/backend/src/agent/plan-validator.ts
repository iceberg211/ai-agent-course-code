import type { SkillRegistry } from '@/skill/skill.registry';
import type { ToolRegistry } from '@/tool/tool.registry';
import type { PlanSemanticValidationOptions } from '@/agent/agent.context';

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

export function validatePlanSemantics(
  steps: RawStep[],
  skillRegistry: SkillRegistry,
  toolRegistry: ToolRegistry,
  options: PlanSemanticValidationOptions = {},
): PlanValidationError[] {
  const errors: PlanValidationError[] = [];
  const allowedTools = new Set(options.allowedSideEffectTools ?? []);
  const allowedSkills = new Set(options.allowedSideEffectSkills ?? []);

  if (steps.length === 0) {
    errors.push({ stepIndex: -1, field: 'steps', message: '计划至少需要包含一个步骤' });
    return errors;
  }
  if (options.maxSteps != null && steps.length > options.maxSteps) {
    errors.push({ stepIndex: -1, field: 'steps', message: `计划步骤数不能超过 ${options.maxSteps}` });
  }

  for (const [i, step] of steps.entries()) {
    if (step.stepIndex !== i) {
      errors.push({ stepIndex: step.stepIndex, field: 'stepIndex', message: 'stepIndex 必须按数组顺序从 0 开始连续递增' });
    }
    if (!step.description?.trim()) {
      errors.push({ stepIndex: i, field: 'description', message: 'description 不能为空' });
    }

    const hasSkill = Boolean(step.skillName && String(step.skillName).trim());
    const hasTool = Boolean(step.toolHint && String(step.toolHint).trim());
    const hasSubAgent = Boolean(step.subAgent && String(step.subAgent).trim());

    if (!hasSkill && !hasTool && !hasSubAgent) {
      errors.push({ stepIndex: i, field: 'executor', message: '步骤必须指定 skillName、toolHint 或 subAgent 之一' });
      continue;
    }
    if (hasSubAgent) continue; // SubAgent steps need no further validation

    if (hasSkill && hasTool) {
      errors.push({ stepIndex: i, field: 'executor', message: '步骤不能同时指定 skillName 和 toolHint' });
      continue;
    }

    if (hasSkill) {
      const name = step.skillName!;
      if (!skillRegistry.has(name)) {
        errors.push({ stepIndex: i, field: 'skillName', message: `Skill "${name}" 未注册，可用：${skillRegistry.getAll().map(s => s.name).join(', ')}` });
      } else {
        const skill = skillRegistry.get(name);
        if (skill.effect === 'side-effect' && !allowedSkills.has(name)) {
          errors.push({ stepIndex: i, field: 'skillName', message: `Side-effect Skill "${name}" 未在允许列表中` });
        }
        if (step.skillInput != null) {
          const result = skill.inputSchema.safeParse(step.skillInput);
          if (!result.success) {
            errors.push({ stepIndex: i, field: 'skillInput', message: `skillInput 不符合 schema: ${result.error.issues.map(x => x.message).join('; ')}` });
          }
        }
      }
    }

    if (hasTool) {
      const name = step.toolHint!;
      if (!toolRegistry.has(name)) {
        errors.push({ stepIndex: i, field: 'toolHint', message: `Tool "${name}" 未注册，可用：${toolRegistry.getAll().map(t => t.name).join(', ')}` });
      } else {
        const tool = toolRegistry.get(name);
        if (tool.type === 'side-effect' && !allowedTools.has(name)) {
          errors.push({ stepIndex: i, field: 'toolHint', message: `Side-effect Tool "${name}" 未在允许列表中` });
        }
        if (step.toolInput != null) {
          const result = tool.schema.safeParse(step.toolInput);
          if (!result.success) {
            errors.push({ stepIndex: i, field: 'toolInput', message: `toolInput 不符合 schema: ${result.error.issues.map(x => x.message).join('; ')}` });
          }
        }
      }
    }
  }

  return errors;
}

export function formatValidationErrors(errors: PlanValidationError[]): string {
  return (
    '\n\n[语义校验失败，请修正以下问题后重新输出完整计划]\n' +
    errors.map(e => `  步骤 ${e.stepIndex} [${e.field}]：${e.message}`).join('\n')
  );
}
