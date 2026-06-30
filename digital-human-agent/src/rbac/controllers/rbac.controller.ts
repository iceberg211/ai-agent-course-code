import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { PermissionGuard } from '@/rbac/guards/permission.guard';
import { RequirePermissions } from '@/rbac/decorators/permissions.decorator';
import { AuthorizationService } from '@/rbac/services/authorization.service';
import { RbacService } from '@/rbac/services/rbac.service';
import {
  AssignUserRolesDto,
  CreatePermissionDto,
  CreateRoleDto,
  UpdateRoleDto,
} from '@/rbac/dto/rbac.dto';

@ApiTags('RBAC 权限')
@Controller('rbac')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RbacController {
  constructor(
    private readonly rbacService: RbacService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Get('roles')
  @RequirePermissions('system:role-manage')
  @ApiOperation({ summary: '角色列表' })
  listRoles() {
    return this.rbacService.listRoles();
  }

  @Post('roles')
  @RequirePermissions('system:role-manage')
  @ApiOperation({ summary: '创建角色' })
  createRole(@Body() dto: CreateRoleDto) {
    return this.rbacService.createRole(dto);
  }

  @Patch('roles/:id')
  @RequirePermissions('system:role-manage')
  @ApiOperation({ summary: '更新角色' })
  updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rbacService.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @RequirePermissions('system:role-manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除角色' })
  async deleteRole(@Param('id') id: string) {
    await this.rbacService.deleteRole(id);
  }

  @Get('permissions')
  @RequirePermissions('system:role-manage')
  @ApiOperation({ summary: '权限列表' })
  listPermissions() {
    return this.rbacService.listPermissions();
  }

  @Post('permissions')
  @RequirePermissions('system:role-manage')
  @ApiOperation({ summary: '创建权限' })
  createPermission(@Body() dto: CreatePermissionDto) {
    return this.rbacService.createPermission(dto);
  }

  @Post('users/:userId/roles')
  @RequirePermissions('system:role-manage')
  @ApiOperation({ summary: '分配用户角色' })
  assignUserRoles(
    @Param('userId') userId: string,
    @Body() dto: AssignUserRolesDto,
    @Req() req: any,
  ) {
    return this.rbacService.assignUserRoles(userId, dto, req.user?.id);
  }

  @Get('me/permissions')
  @ApiOperation({ summary: '当前用户权限' })
  getMyPermissions(@Req() req: any) {
    return this.authorizationService.getAuthorizationSnapshot(req.user);
  }

  @Get('me/menus')
  @ApiOperation({ summary: '当前用户菜单' })
  async getMyMenus(@Req() req: any) {
    const snapshot = await this.authorizationService.getAuthorizationSnapshot(req.user);
    return snapshot.menus;
  }
}
