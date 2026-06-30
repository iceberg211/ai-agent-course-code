import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeChunk } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import { ElasticsearchIndexService } from '@/knowledge/elasticsearch/elasticsearch-index.service';
import { KnowledgeGraphService } from '@/knowledge/graph/knowledge-graph.service';
import { DocumentAclEntity, type AclResourceAction } from '@/rbac/entities';

export interface AclIndexMetadata {
  allowedUserIds: string[] | null;
  allowedRoleIds: string[] | null;
  allowedDepartmentIds: string[] | null;
  securityLevel: number;
  aclVersion: number;
}

@Injectable()
export class AclIndexRefreshService {
  private readonly logger = new Logger(AclIndexRefreshService.name);

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepo: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepo: Repository<KnowledgeChunk>,
    @InjectRepository(DocumentAclEntity)
    private readonly documentAclRepo: Repository<DocumentAclEntity>,
    @Optional()
    private readonly moduleRef?: ModuleRef,
  ) {}

  async refreshDocumentAclIndex(documentId: string): Promise<{
    documentId: string;
    chunkCount: number;
    metadata: AclIndexMetadata;
  }> {
    const document = await this.documentRepo.findOne({
      where: { id: documentId },
    });
    if (!document) {
      throw new Error('文档不存在');
    }

    const aclRules = await this.documentAclRepo.find({
      where: { documentId },
      order: { createdAt: 'ASC' },
    });
    const metadata = this.buildMetadata(document, aclRules);

    const updateResult = await this.chunkRepo
      .createQueryBuilder()
      .update(KnowledgeChunk)
      .set({
        allowedUserIds: metadata.allowedUserIds,
        allowedRoleIds: metadata.allowedRoleIds,
        allowedDepartmentIds: metadata.allowedDepartmentIds,
        securityLevel: metadata.securityLevel,
        aclVersion: metadata.aclVersion,
      })
      .where('document_id = :documentId', { documentId })
      .execute();

    await this.syncElasticsearch(documentId, 'refresh_acl_index');
    await this.syncNeo4j(documentId, metadata, 'refresh_acl_index');

    return {
      documentId,
      chunkCount: updateResult.affected ?? 0,
      metadata,
    };
  }

  private buildMetadata(
    document: KnowledgeDocument,
    aclRules: DocumentAclEntity[],
  ): AclIndexMetadata {
    const userIds = new Set<string>();
    const roleIds = new Set<string>();
    const departmentIds = new Set<string>();

    let securityLevel = 0;
    if (document.visibility === 'department') {
      securityLevel = 20;
      if (document.department) departmentIds.add(document.department);
    }
    if (document.visibility === 'private') {
      securityLevel = 30;
      if (document.ownerId) userIds.add(document.ownerId);
    }

    for (const rule of aclRules) {
      if (rule.effect !== 'allow') continue;
      if (!this.includesReadAction(rule.actions)) continue;
      if (rule.subjectType === 'user') userIds.add(rule.subjectId);
      if (rule.subjectType === 'role') roleIds.add(rule.subjectId);
      if (rule.subjectType === 'department') departmentIds.add(rule.subjectId);
    }

    if (aclRules.some((rule) => rule.effect === 'deny')) {
      securityLevel = Math.max(securityLevel, 40);
    }

    return {
      allowedUserIds: this.toNullableArray(userIds),
      allowedRoleIds: this.toNullableArray(roleIds),
      allowedDepartmentIds: this.toNullableArray(departmentIds),
      securityLevel,
      aclVersion: Date.now(),
    };
  }

  private includesReadAction(actions: AclResourceAction[]): boolean {
    return actions.includes('read') || actions.includes('manage');
  }

  private toNullableArray(values: Set<string>): string[] | null {
    const list = Array.from(values).filter(Boolean).sort();
    return list.length > 0 ? list : null;
  }

  private async syncElasticsearch(
    documentId: string,
    reason: string,
  ): Promise<void> {
    const service = this.tryGet(ElasticsearchIndexService);
    if (!service) return;

    const documents = await service.listByDocumentId(documentId);
    await service.safeBulkUpsertChunkDocuments(documents, reason);
  }

  private async syncNeo4j(
    documentId: string,
    metadata: AclIndexMetadata,
    reason: string,
  ): Promise<void> {
    const service = this.tryGet(KnowledgeGraphService);
    if (!service) return;

    await service.safeRefreshChunkAccessMetadata(
      {
        documentId,
        allowedUserIds: metadata.allowedUserIds,
        allowedRoleIds: metadata.allowedRoleIds,
        allowedDepartmentIds: metadata.allowedDepartmentIds,
        securityLevel: metadata.securityLevel,
        aclVersion: metadata.aclVersion,
      },
      reason,
    );
  }

  private tryGet<T>(token: new (...args: any[]) => T): T | null {
    if (!this.moduleRef) return null;
    try {
      return this.moduleRef.get(token, { strict: false });
    } catch (error) {
      this.logger.debug(
        `未找到可选服务 ${token.name}，跳过 ACL 派生同步：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
