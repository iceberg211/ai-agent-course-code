import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { DatabaseModule } from '@/database/database.module';
import { KnowledgeContentModule } from '@/knowledge-content/knowledge-content.module';
import { RagLiveKeywordEvalModule } from '@/knowledge-content/evaluation/rag-live-keyword-eval.module';

describe('RagLiveKeywordEvalModule', () => {
  it('只装配 live-keyword-only 评估需要的后端模块', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      RagLiveKeywordEvalModule,
    );

    expect(imports).toEqual(
      expect.arrayContaining([DatabaseModule, KnowledgeContentModule]),
    );
    expect(imports.map((item: unknown) => String(item))).not.toContain(
      'AppModule',
    );
  });
});
