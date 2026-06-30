import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { KnowledgeAccessScope } from '@/knowledge/types/knowledge-content.types';
import {
  DocumentAclEntity,
  KnowledgeBaseAclEntity,
  MenuPermissionEntity,
  PermissionEntity,
  RoleEntity,
  RolePermissionEntity,
  UserRoleEntity,
  type AclResourceAction,
} from '@/rbac/entities';

export interface AuthenticatedUserLike {
  id?: string;
  username?: string;
  role?: string | null;
  department?: string | null;
}

export interface AuthorizationSnapshot {
  roles: Array<{ id: string | null; code: string; name: string }>;
  permissions: string[];
  menus: Array<{
    code: string;
    name: string;
    path: string;
    permissionCode: string;
    sortOrder: number;
    parentCode: string | null;
  }>;
  accessScope: KnowledgeAccessScope;
}

@Injectable()
export class AuthorizationService {
  constructor(
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(PermissionEntity)
    private readonly permissionRepo: Repository<PermissionEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepo: Repository<UserRoleEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissionRepo: Repository<RolePermissionEntity>,
    @InjectRepository(MenuPermissionEntity)
    private readonly menuRepo: Repository<MenuPermissionEntity>,
    @InjectRepository(DocumentAclEntity)
    private readonly documentAclRepo: Repository<DocumentAclEntity>,
    @InjectRepository(KnowledgeBaseAclEntity)
    private readonly knowledgeBaseAclRepo: Repository<KnowledgeBaseAclEntity>,
  ) {}

  toAccessScope(user?: AuthenticatedUserLike | null): KnowledgeAccessScope {
    return {
      ownerId: user?.id ?? null,
      department: user?.department ?? null,
      role: user?.role ?? null,
    };
  }

  isLegacyAdmin(user?: AuthenticatedUserLike | null): boolean {
    return user?.role === 'admin';
  }

  async getUserRoleCodes(user?: AuthenticatedUserLike | null): Promise<string[]> {
    const roleCodes = new Set<string>();
    if (user?.role) roleCodes.add(user.role);
    if (!user?.id) return Array.from(roleCodes);

    const userRoles = await this.userRoleRepo.find({
      where: { userId: user.id },
      relations: { role: true },
    });
    for (const item of userRoles) {
      if (item.role?.code) roleCodes.add(item.role.code);
    }
    return Array.from(roleCodes);
  }

  async getUserPermissions(user?: AuthenticatedUserLike | null): Promise<string[]> {
    if (this.isLegacyAdmin(user)) return ['*'];

    const roleCodes = await this.getUserRoleCodes(user);
    if (roleCodes.length === 0) return [];

    const roles = await this.roleRepo.find({
      where: { code: In(roleCodes) },
      select: ['id', 'code'],
    });
    const roleIds = roles.map((role) => role.id);
    if (roleIds.length === 0) return [];

    const rows = await this.rolePermissionRepo.find({
      where: { roleId: In(roleIds) },
      relations: { permission: true },
    });
    return Array.from(
      new Set(
        rows
          .map((row) => row.permission?.code)
          .filter((code): code is string => Boolean(code)),
      ),
    ).sort();
  }

  async hasPermission(
    user: AuthenticatedUserLike | null | undefined,
    permissionCode: string,
  ): Promise<boolean> {
    if (!permissionCode) return true;
    if (this.isLegacyAdmin(user)) return true;
    const permissions = await this.getUserPermissions(user);
    return this.permissionListAllows(permissions, permissionCode);
  }

  async hasAllPermissions(
    user: AuthenticatedUserLike | null | undefined,
    permissionCodes: string[],
  ): Promise<boolean> {
    const required = permissionCodes.filter(Boolean);
    if (required.length === 0) return true;
    if (this.isLegacyAdmin(user)) return true;
    const permissions = await this.getUserPermissions(user);
    return required.every((code) => this.permissionListAllows(permissions, code));
  }

  async getAuthorizationSnapshot(
    user: AuthenticatedUserLike,
  ): Promise<AuthorizationSnapshot> {
    const [roles, permissions] = await Promise.all([
      this.getUserRoles(user),
      this.getUserPermissions(user),
    ]);
    const menus = await this.listMenusForPermissions(permissions);
    return {
      roles,
      permissions,
      menus,
      accessScope: this.toAccessScope(user),
    };
  }

  async getUserRoles(
    user?: AuthenticatedUserLike | null,
  ): Promise<Array<{ id: string | null; code: string; name: string }>> {
    const roleCodes = await this.getUserRoleCodes(user);
    if (roleCodes.length === 0) return [];
    const roles = await this.roleRepo.find({ where: { code: In(roleCodes) } });
    const byCode = new Map(roles.map((role) => [role.code, role]));
    return roleCodes.map((code) => {
      const role = byCode.get(code);
      return {
        id: role?.id ?? null,
        code,
        name: role?.name ?? code,
      };
    });
  }

  async listMenusForPermissions(
    permissions: string[],
  ): Promise<AuthorizationSnapshot['menus']> {
    const menus = await this.menuRepo.find({ order: { sortOrder: 'ASC' } });
    return menus
      .filter((menu) => this.permissionListAllows(permissions, menu.permissionCode))
      .map((menu) => ({
        code: menu.code,
        name: menu.name,
        path: menu.path,
        permissionCode: menu.permissionCode,
        sortOrder: menu.sortOrder,
        parentCode: menu.parentCode,
      }));
  }

  async canAccessDocument(
    user: AuthenticatedUserLike | null | undefined,
    params: {
      documentId: string;
      action?: AclResourceAction;
      visibility?: 'private' | 'department' | 'company' | null;
      ownerId?: string | null;
      department?: string | null;
    },
  ): Promise<boolean> {
    if (this.isLegacyAdmin(user)) return true;
    const action = params.action ?? 'read';
    const baseVisible = this.isVisibleByScope(user, params);
    const aclDecision = await this.resolveDocumentAcl(user, params.documentId, action);
    if (aclDecision === 'deny') return false;
    if (aclDecision === 'allow') return true;
    return baseVisible;
  }

  async canAccessKnowledgeBase(
    user: AuthenticatedUserLike | null | undefined,
    knowledgeBaseId: string,
    action: AclResourceAction = 'read',
  ): Promise<boolean> {
    if (this.isLegacyAdmin(user)) return true;
    const decision = await this.resolveKnowledgeBaseAcl(user, knowledgeBaseId, action);
    return decision !== 'deny';
  }

  private permissionListAllows(permissions: string[], required: string): boolean {
    if (permissions.includes('*')) return true;
    if (permissions.includes(required)) return true;
    const [resource] = required.split(':');
    return permissions.includes(`${resource}:*`);
  }

  private isVisibleByScope(
    user: AuthenticatedUserLike | null | undefined,
    params: {
      visibility?: 'private' | 'department' | 'company' | null;
      ownerId?: string | null;
      department?: string | null;
    },
  ): boolean {
    if (!params.visibility || params.visibility === 'company') return true;
    if (params.visibility === 'department') {
      return Boolean(user?.department && user.department === params.department);
    }
    return Boolean(user?.id && user.id === params.ownerId);
  }

  private async resolveDocumentAcl(
    user: AuthenticatedUserLike | null | undefined,
    documentId: string,
    action: AclResourceAction,
  ): Promise<'allow' | 'deny' | 'none'> {
    if (!user?.id) return 'none';
    const roleCodes = await this.getUserRoleCodes(user);
    const rules = await this.documentAclRepo.find({
      where: { documentId },
      order: { createdAt: 'DESC' },
    });
    return this.resolveAclRules(rules, user, roleCodes, action);
  }

  private async resolveKnowledgeBaseAcl(
    user: AuthenticatedUserLike | null | undefined,
    knowledgeBaseId: string,
    action: AclResourceAction,
  ): Promise<'allow' | 'deny' | 'none'> {
    if (!user?.id) return 'none';
    const roleCodes = await this.getUserRoleCodes(user);
    const rules = await this.knowledgeBaseAclRepo.find({
      where: { knowledgeBaseId },
      order: { createdAt: 'DESC' },
    });
    return this.resolveAclRules(rules, user, roleCodes, action);
  }

  private resolveAclRules(
    rules: Array<{
      subjectType: string;
      subjectId: string;
      actions: AclResourceAction[];
      effect: 'allow' | 'deny';
    }>,
    user: AuthenticatedUserLike,
    roleCodes: string[],
    action: AclResourceAction,
  ): 'allow' | 'deny' | 'none' {
    let allow = false;
    for (const rule of rules) {
      if (!rule.actions.includes(action) && !rule.actions.includes('manage')) {
        continue;
      }
      const matched =
        (rule.subjectType === 'user' && rule.subjectId === user.id) ||
        (rule.subjectType === 'department' && rule.subjectId === user.department) ||
        (rule.subjectType === 'role' && roleCodes.includes(rule.subjectId));
      if (!matched) continue;
      if (rule.effect === 'deny') return 'deny';
      allow = true;
    }
    return allow ? 'allow' : 'none';
  }
}
