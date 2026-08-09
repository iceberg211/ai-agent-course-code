import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthorizationService } from '@/rbac/services/authorization.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Optional()
    private readonly authorizationService?: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.role) {
      return false;
    }
    const roleCodes = this.authorizationService
      ? await this.authorizationService.getUserRoleCodes(user)
      : [user.role];
    const hasRole = roleCodes.some((role) => requiredRoles.includes(role));
    if (!hasRole) {
      throw new ForbiddenException('权限不足，无法访问该资源');
    }
    return true;
  }
}
