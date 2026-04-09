import { Module } from '@nestjs/common';
import { SkillRegistry } from '@/skill/skill.registry';
import { WebResearchSkill } from '@/skill/skills/web-research.skill';
import { DocumentWritingSkill } from '@/skill/skills/document-writing.skill';
import { CompetitiveAnalysisSkill } from '@/skill/skills/competitive-analysis.skill';
import { BriefingGenerationSkill } from '@/skill/skills/briefing-generation.skill';
import { ArtifactReviewSkill } from '@/skill/skills/artifact-review.skill';
import { ReportPackagingSkill } from '@/skill/skills/report-packaging.skill';
import { ToolModule } from '@/tool/tool.module';

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
    this.registry.register(new CompetitiveAnalysisSkill());
    this.registry.register(new BriefingGenerationSkill());
    this.registry.register(new ArtifactReviewSkill());
    this.registry.register(new ReportPackagingSkill());
  }
}
