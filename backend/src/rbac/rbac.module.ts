import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  DepartmentEntity,
  DocumentAclEntity,
  KnowledgeBaseAclEntity,
  MenuPermissionEntity,
  PermissionEntity,
  RoleEntity,
  RolePermissionEntity,
  UserRoleEntity,
} from '@/rbac/entities';
import { RbacController } from '@/rbac/controllers/rbac.controller';
import { AclIndexQueueService } from '@/rbac/services/acl-index-queue.service';
import { AclIndexRefreshService } from '@/rbac/services/acl-index-refresh.service';
import { AclIndexWorkerService } from '@/rbac/services/acl-index-worker.service';
import { AuthorizationService } from '@/rbac/services/authorization.service';
import { DataScopeService } from '@/rbac/services/data-scope.service';
import { RbacService } from '@/rbac/services/rbac.service';
import { PermissionGuard } from '@/rbac/guards/permission.guard';
import { KnowledgeChunk } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import { QueueModule } from '@/queue/queue.module';
import { User } from '@/user/entities/user.entity';

@Module({
  imports: [
    QueueModule,
    TypeOrmModule.forFeature([
      DepartmentEntity,
      DocumentAclEntity,
      KnowledgeBaseAclEntity,
      MenuPermissionEntity,
      PermissionEntity,
      RoleEntity,
      RolePermissionEntity,
      UserRoleEntity,
      User,
      KnowledgeDocument,
      KnowledgeChunk,
    ]),
  ],
  controllers: [RbacController],
  providers: [
    AclIndexQueueService,
    AclIndexRefreshService,
    AclIndexWorkerService,
    AuthorizationService,
    DataScopeService,
    RbacService,
    PermissionGuard,
  ],
  exports: [
    AclIndexQueueService,
    AclIndexRefreshService,
    AuthorizationService,
    DataScopeService,
    RbacService,
    PermissionGuard,
    TypeOrmModule,
  ],
})
export class RbacModule {}
