import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  PermissionEntity,
  DocumentAclEntity,
  KnowledgeBaseAclEntity,
  RoleEntity,
  RolePermissionEntity,
  UserRoleEntity,
} from '@/rbac/entities';
import {
  AssignUserRolesDto,
  CreateAclRuleDto,
  CreatePermissionDto,
  CreateRoleDto,
  UpdateRoleDto,
} from '@/rbac/dto/rbac.dto';
import { AclIndexQueueService } from '@/rbac/services/acl-index-queue.service';

@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(PermissionEntity)
    private readonly permissionRepo: Repository<PermissionEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissionRepo: Repository<RolePermissionEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepo: Repository<UserRoleEntity>,
    @InjectRepository(DocumentAclEntity)
    private readonly documentAclRepo: Repository<DocumentAclEntity>,
    @InjectRepository(KnowledgeBaseAclEntity)
    private readonly knowledgeBaseAclRepo: Repository<KnowledgeBaseAclEntity>,
    private readonly aclIndexQueueService: AclIndexQueueService,
  ) {}

  async listRoles() {
    const roles = await this.roleRepo.find({ order: { createdAt: 'ASC' } });
    const rows = await this.rolePermissionRepo.find({ relations: { permission: true } });
    const permissionsByRole = new Map<string, string[]>();
    for (const row of rows) {
      const list = permissionsByRole.get(row.roleId) ?? [];
      if (row.permission?.code) list.push(row.permission.code);
      permissionsByRole.set(row.roleId, list);
    }
    return roles.map((role) => ({
      ...role,
      permissionCodes: (permissionsByRole.get(role.id) ?? []).sort(),
    }));
  }

  async createRole(dto: CreateRoleDto) {
    const existing = await this.roleRepo.findOne({ where: { code: dto.code } });
    if (existing) throw new BadRequestException('角色编码已存在');
    const role = await this.roleRepo.save(
      this.roleRepo.create({
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        builtin: dto.builtin ?? false,
      }),
    );
    if (dto.permissionCodes?.length) {
      await this.replaceRolePermissions(role.id, dto.permissionCodes);
    }
    return this.getRoleOrThrow(role.id);
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    const role = await this.getRoleOrThrow(id);
    await this.roleRepo.save({
      ...role,
      name: dto.name ?? role.name,
      description: dto.description === undefined ? role.description : dto.description,
    });
    if (dto.permissionCodes) {
      await this.replaceRolePermissions(id, dto.permissionCodes);
    }
    return this.getRoleOrThrow(id);
  }

  async deleteRole(id: string) {
    const role = await this.getRoleOrThrow(id);
    if (role.builtin) throw new BadRequestException('内置角色不能删除');
    await this.roleRepo.delete(id);
  }

  async listPermissions() {
    return this.permissionRepo.find({ order: { resource: 'ASC', action: 'ASC' } });
  }

  async createPermission(dto: CreatePermissionDto) {
    const existing = await this.permissionRepo.findOne({ where: { code: dto.code } });
    if (existing) throw new BadRequestException('权限编码已存在');
    return this.permissionRepo.save(
      this.permissionRepo.create({
        code: dto.code,
        name: dto.name,
        type: dto.type,
        resource: dto.resource,
        action: dto.action,
        description: dto.description ?? null,
      }),
    );
  }

  async assignUserRoles(userId: string, dto: AssignUserRolesDto, assignedBy?: string) {
    const roles = dto.roleCodes.length
      ? await this.roleRepo.find({ where: { code: In(dto.roleCodes) } })
      : [];
    const foundCodes = new Set(roles.map((role) => role.code));
    const missing = dto.roleCodes.filter((code) => !foundCodes.has(code));
    if (missing.length > 0) {
      throw new BadRequestException(`角色不存在：${missing.join(', ')}`);
    }
    await this.userRoleRepo.delete({ userId });
    if (roles.length > 0) {
      await this.userRoleRepo.save(
        roles.map((role) =>
          this.userRoleRepo.create({
            userId,
            roleId: role.id,
            assignedBy: assignedBy ?? null,
          }),
        ),
      );
    }
    return { userId, roleCodes: roles.map((role) => role.code) };
  }

  listDocumentAcl(documentId: string) {
    return this.documentAclRepo.find({
      where: { documentId },
      order: { createdAt: 'DESC' },
    });
  }

  async createDocumentAcl(documentId: string, dto: CreateAclRuleDto) {
    const saved = await this.documentAclRepo.save(
      this.documentAclRepo.create({
        documentId,
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        actions: Array.from(new Set(dto.actions)),
        effect: dto.effect ?? 'allow',
      }),
    );
    await this.aclIndexQueueService.enqueueDocumentRefresh(
      documentId,
      'document_acl_changed',
    );
    return saved;
  }

  async deleteDocumentAcl(id: string) {
    const rule = await this.documentAclRepo.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('文档 ACL 规则不存在');
    await this.documentAclRepo.delete(id);
    await this.aclIndexQueueService.enqueueDocumentRefresh(
      rule.documentId,
      'document_acl_deleted',
    );
  }

  listKnowledgeBaseAcl(knowledgeBaseId: string) {
    return this.knowledgeBaseAclRepo.find({
      where: { knowledgeBaseId },
      order: { createdAt: 'DESC' },
    });
  }

  createKnowledgeBaseAcl(knowledgeBaseId: string, dto: CreateAclRuleDto) {
    return this.knowledgeBaseAclRepo.save(
      this.knowledgeBaseAclRepo.create({
        knowledgeBaseId,
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        actions: Array.from(new Set(dto.actions)),
        effect: dto.effect ?? 'allow',
      }),
    );
  }

  async deleteKnowledgeBaseAcl(id: string) {
    const rule = await this.knowledgeBaseAclRepo.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('知识库 ACL 规则不存在');
    await this.knowledgeBaseAclRepo.delete(id);
  }

  private async getRoleOrThrow(id: string) {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) throw new NotFoundException('角色不存在');
    const rows = await this.rolePermissionRepo.find({
      where: { roleId: role.id },
      relations: { permission: true },
    });
    return {
      ...role,
      permissionCodes: rows
        .map((row) => row.permission?.code)
        .filter((code): code is string => Boolean(code))
        .sort(),
    };
  }

  private async replaceRolePermissions(roleId: string, permissionCodes: string[]) {
    const uniqueCodes = Array.from(new Set(permissionCodes));
    const permissions = uniqueCodes.length
      ? await this.permissionRepo.find({ where: { code: In(uniqueCodes) } })
      : [];
    const foundCodes = new Set(permissions.map((permission) => permission.code));
    const missing = uniqueCodes.filter((code) => !foundCodes.has(code));
    if (missing.length > 0) {
      throw new BadRequestException(`权限不存在：${missing.join(', ')}`);
    }
    await this.rolePermissionRepo.delete({ roleId });
    if (permissions.length > 0) {
      await this.rolePermissionRepo.save(
        permissions.map((permission) =>
          this.rolePermissionRepo.create({
            roleId,
            permissionId: permission.id,
          }),
        ),
      );
    }
  }
}
