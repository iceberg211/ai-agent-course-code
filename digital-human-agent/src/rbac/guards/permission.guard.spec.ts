import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { PERMISSIONS_KEY } from '@/rbac/decorators/permissions.decorator';

describe('PermissionGuard', () => {
  const createContext = (user?: any): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ user }),
      }),
    }) as unknown as ExecutionContext;

  it('没有权限要求时放行', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const auth = { hasAllPermissions: jest.fn() };
    const guard = new PermissionGuard(reflector, auth as any);

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(PERMISSIONS_KEY, [
      undefined,
      undefined,
    ]);
  });

  it('有权限时放行', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['documents:view']),
    } as unknown as Reflector;
    const auth = { hasAllPermissions: jest.fn().mockResolvedValue(true) };
    const guard = new PermissionGuard(reflector, auth as any);

    await expect(guard.canActivate(createContext({ id: 'u1' }))).resolves.toBe(true);
  });

  it('缺少权限时拒绝访问', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['system:role-manage']),
    } as unknown as Reflector;
    const auth = { hasAllPermissions: jest.fn().mockResolvedValue(false) };
    const guard = new PermissionGuard(reflector, auth as any);

    await expect(guard.canActivate(createContext({ id: 'u1' }))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
