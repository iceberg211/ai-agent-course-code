import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from '@/common/auth/api-key.guard';

function createContext(method: string, apiKey?: string): ExecutionContext {
  return {
    getType: jest.fn(() => 'http'),
    switchToHttp: jest.fn(() => ({
      getRequest: () => ({
        method,
        headers: apiKey ? { 'x-api-key': apiKey } : {},
      }),
    })),
  } as unknown as ExecutionContext;
}

function createGuard(rawKeys: string) {
  const config = {
    get: jest.fn(() => rawKeys),
  } as unknown as ConfigService;
  return new ApiKeyGuard(config);
}

describe('ApiKeyGuard', () => {
  it('允许读请求匿名访问', () => {
    const guard = createGuard('secret');

    expect(guard.canActivate(createContext('GET'))).toBe(true);
  });

  it('未配置 APP_API_KEYS 时允许开发环境写请求', () => {
    const guard = createGuard('');

    expect(guard.canActivate(createContext('POST'))).toBe(true);
  });

  it('写请求需要有效 x-api-key', () => {
    const guard = createGuard('secret-a,secret-b');

    expect(guard.canActivate(createContext('POST', 'secret-b'))).toBe(true);
    expect(() => guard.canActivate(createContext('POST', 'wrong'))).toThrow(
      UnauthorizedException,
    );
  });
});
