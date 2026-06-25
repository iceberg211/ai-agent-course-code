import { UnauthorizedException } from '@nestjs/common';
import { ApiKeyStrategy } from './api-key.strategy';
import { AuthService } from '@/auth/services/auth.service';
import { User } from '@/user/entities/user.entity';

describe('ApiKeyStrategy', () => {
  let strategy: ApiKeyStrategy;
  let authService: AuthService;

  beforeEach(() => {
    authService = {
      validateApiKey: jest.fn(),
    } as unknown as AuthService;

    strategy = new ApiKeyStrategy(authService);
  });

  it('若未提供 API Key，应抛出 UnauthorizedException 并提示未提供', async () => {
    const req = { headers: {} };

    await expect(strategy.validate(req)).rejects.toThrow(
      new UnauthorizedException('未提供 API Key'),
    );
  });

  it('若提供的 API Key 校验失败，应抛出 UnauthorizedException 并提示无效', async () => {
    const req = { headers: { 'x-api-key': 'dh_invalid_key' } };
    jest.spyOn(authService, 'validateApiKey').mockResolvedValue(null);

    await expect(strategy.validate(req)).rejects.toThrow(
      new UnauthorizedException('API Key 无效或已被废弃'),
    );
    expect(authService.validateApiKey).toHaveBeenCalledWith('dh_invalid_key');
  });

  it('若通过 X-API-Key 提供有效 Key，应成功返回用户信息', async () => {
    const req = { headers: { 'x-api-key': 'dh_valid_key' } };
    const mockUser = { id: 'user-id', username: 'testuser', role: 'admin' } as User;
    jest.spyOn(authService, 'validateApiKey').mockResolvedValue(mockUser);

    const result = await strategy.validate(req);

    expect(result).toEqual({
      id: 'user-id',
      username: 'testuser',
      role: 'admin',
    });
  });

  it('若通过 Authorization Bearer 提供有效 dh_ 开头的 Key，应成功返回用户信息', async () => {
    const req = { headers: { authorization: 'bearer dh_valid_key' } };
    const mockUser = { id: 'user-id', username: 'testuser', role: 'user' } as User;
    jest.spyOn(authService, 'validateApiKey').mockResolvedValue(mockUser);

    const result = await strategy.validate(req);

    expect(authService.validateApiKey).toHaveBeenCalledWith('dh_valid_key');
    expect(result).toEqual({
      id: 'user-id',
      username: 'testuser',
      role: 'user',
    });
  });
});
