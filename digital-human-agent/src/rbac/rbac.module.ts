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
import { AuthorizationService } from '@/rbac/services/authorization.service';
import { DataScopeService } from '@/rbac/services/data-scope.service';
import { RbacService } from '@/rbac/services/rbac.service';
import { PermissionGuard } from '@/rbac/guards/permission.guard';
import { KnowledgeChunk } from '@/knowledge/entities/knowledge-chunk.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DepartmentEntity,
      DocumentAclEntity,
      KnowledgeBaseAclEntity,
      MenuPermissionEntity,
      PermissionEntity,
      RoleEntity,
      RolePermissionEntity,
      UserRoleEntity,
      KnowledgeChunk,
    ]),
  ],
  controllers: [RbacController],
  providers: [AuthorizationService, DataScopeService, RbacService, PermissionGuard],
  exports: [
    AuthorizationService,
    DataScopeService,
    RbacService,
    PermissionGuard,
    TypeOrmModule,
  ],
})
export class RbacModule {}
