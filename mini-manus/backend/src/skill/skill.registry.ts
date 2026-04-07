import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Skill, SkillForPlanner } from '@/skill/interfaces/skill.interface';

@Injectable()
export class SkillRegistry implements OnModuleInit {
  private readonly logger = new Logger(SkillRegistry.name);
  private readonly skills = new Map<string, Skill>();

  onModuleInit() {
    this.logger.log(
      `SkillRegistry initialized with ${this.skills.size} skills`,
    );
  }

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
    this.logger.debug(`Registered skill: ${skill.name} [${skill.effect}]`);
  }

  get(name: string): Skill {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill not found: ${name}`);
    return skill;
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /** Returns skill descriptions + input shapes for planner prompt injection */
  getForPlanner(): SkillForPlanner[] {
    return this.getAll().map((s) => ({
      name: s.name,
      description: s.description,
      inputShape: JSON.stringify(
        s.inputSchema.description ?? s.inputSchema._def,
      ),
    }));
  }

  getPlannerPromptSection(): string {
    const skills = this.getForPlanner();
    if (skills.length === 0) return '';
    return (
      '当前系统已加载以下 skills（含输入参数定义）：\n' +
      skills
        .map((s) => `- ${s.name}(${s.inputShape}): ${s.description}`)
        .join('\n')
    );
  }
}
