import { Module } from '@nestjs/common';
import { SkillRegistry } from './skill.registry';
import { WebResearchSkill } from './skills/web-research.skill';
import { DocumentWritingSkill } from './skills/document-writing.skill';
import { ToolModule } from '../tool/tool.module';

@Module({
  imports: [ToolModule],
  providers: [SkillRegistry],
  exports: [SkillRegistry],
})
export class SkillModule {
  constructor(private readonly registry: SkillRegistry) {}

  onModuleInit() {
    this.registry.register(new WebResearchSkill());
    this.registry.register(new DocumentWritingSkill());
  }
}
