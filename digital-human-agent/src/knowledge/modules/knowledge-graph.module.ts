import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '@/common/common.module';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import { Neo4jGraphService } from '@/knowledge/graph/neo4j-graph.service';
import { KnowledgeGraphService } from '@/knowledge/graph/knowledge-graph.service';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([KnowledgeDocument]),
  ],
  providers: [
    Neo4jGraphService,
    KnowledgeGraphService,
  ],
  exports: [
    Neo4jGraphService,
    KnowledgeGraphService,
  ],
})
export class KnowledgeGraphModule {}
