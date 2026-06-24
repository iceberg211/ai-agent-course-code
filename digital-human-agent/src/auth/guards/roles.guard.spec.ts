import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as Reflector;

    guard = new RolesGuard(reflector);
  });

  const createMockExecutionContext = (user?: any): ExecutionContext => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ user }),
      }),
    } as unknown as ExecutionContext;
  };

  it('如果没有配置角色要求，应放行 (返回 true)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(null);
    const context = createMockExecutionContext();

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('如果配置了角色但未提供用户，应拒绝访问 (返回 false)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const context = createMockExecutionContext(null);

    const result = guard.canActivate(context);

    expect(result).toBe(false);
  });

  it('如果有用户且角色匹配，应放行 (返回 true)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin', 'user']);
    const context = createMockExecutionContext({ role: 'admin' });

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('如果有用户但角色不匹配，应抛出 ForbiddenException', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const context = createMockExecutionContext({ role: 'user' });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
