import { Module } from '@nestjs/common';
import { SkillRegistry } from '@/skill/skill.registry';
import { CodeProjectGenerationSkill } from '@/skill/skills/code-project-generation.skill';
import { CodeFixSkill } from '@/skill/skills/code-fix.skill';
import { ToolModule } from '@/tool/tool.module';

@Module({
  imports: [ToolModule],
  providers: [SkillRegistry],
  exports: [SkillRegistry],
})
export class SkillModule {
  constructor(private readonly registry: SkillRegistry) {}

  onModuleInit() {
    // V1 True Skills：单次 LLM 调用生成复杂 artifact，不可分解为 SubAgent 工具链
    // 调研/撰写/对比等 workflow 场景改用 SubAgent（createReactAgent）模式
    this.registry.register(new CodeProjectGenerationSkill());
    this.registry.register(new CodeFixSkill());
  }
}
