import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { PermissionType } from '@/rbac/entities/permission.entity';
import type {
  AclEffect,
  AclResourceAction,
  AclSubjectType,
} from '@/rbac/entities';

export class CreateRoleDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  builtin?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionCodes?: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionCodes?: string[];
}

export class AssignUserRolesDto {
  @IsArray()
  @IsString({ each: true })
  roleCodes: string[];
}

export class ListRbacUsersDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class UpdateUserDepartmentDto {
  @IsOptional()
  @IsString()
  department?: string | null;
}

export class CreateDepartmentDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

export class CreatePermissionDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsIn(['page', 'menu', 'button', 'api', 'data'])
  type: PermissionType;

  @IsString()
  resource: string;

  @IsString()
  action: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class DocumentAclQueryDto {
  @IsUUID()
  documentId: string;
}

export class CreateAclRuleDto {
  @IsIn(['user', 'role', 'department'])
  subjectType: AclSubjectType;

  @IsString()
  subjectId: string;

  @IsArray()
  @IsIn(['read', 'write', 'delete', 'manage'], { each: true })
  actions: AclResourceAction[];

  @IsOptional()
  @IsIn(['allow', 'deny'])
  effect?: AclEffect;
}
