import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import type { PermissionType } from '@/rbac/entities/permission.entity';

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
