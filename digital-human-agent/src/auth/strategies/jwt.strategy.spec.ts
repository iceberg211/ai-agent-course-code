import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserService } from '@/user/services/user.service';
import { JwtStrategy } from './jwt.strategy';
import { User } from '@/user/entities/user.entity';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let configService: ConfigService;
  let userService: UserService;

  beforeEach(() => {
    configService = {
      get: jest.fn().mockReturnValue('mock-jwt-secret'),
    } as unknown as ConfigService;

    userService = {
      findOne: jest.fn(),
    } as unknown as UserService;

    strategy = new JwtStrategy(configService, userService);
  });

  describe('validate', () => {
    it('若用户存在，应成功返回包含角色的用户映射', async () => {
      const mockUser = { id: 'user-id', username: 'testuser', role: 'admin' } as User;
      jest.spyOn(userService, 'findOne').mockResolvedValue(mockUser);

      const result = await strategy.validate({ sub: 'user-id', username: 'testuser' });

      expect(userService.findOne).toHaveBeenCalledWith('user-id');
      expect(result).toEqual({
        id: 'user-id',
        username: 'testuser',
        role: 'admin',
      });
    });

    it('若用户不存在，应抛出 UnauthorizedException', async () => {
      jest.spyOn(userService, 'findOne').mockResolvedValue(null);

      await expect(
        strategy.validate({ sub: 'user-id', username: 'testuser' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
