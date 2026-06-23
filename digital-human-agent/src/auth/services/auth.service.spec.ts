import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { scryptSync, randomBytes } from 'node:crypto';
import { AuthService } from '@/auth/services/auth.service';
import { UserService } from '@/user/services/user.service';
import { User } from '@/user/entities/user.entity';

describe('AuthService', () => {
  let authService: AuthService;
  let userService: UserService;
  let jwtService: JwtService;

  const mockHashPassword = (password: string): string => {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  };

  beforeEach(() => {
    userService = {
      create: jest.fn(),
      findOneByUsername: jest.fn(),
    } as unknown as UserService;

    jwtService = {
      signAsync: jest.fn(),
    } as unknown as JwtService;

    authService = new AuthService(userService, jwtService);
  });

  describe('register', () => {
    it('应调用 UserService.create 来注册用户', async () => {
      const mockUser = { id: 'uuid', username: 'testuser' } as User;
      jest.spyOn(userService, 'create').mockResolvedValue(mockUser);

      const result = await authService.register('testuser', 'password123');

      expect(userService.create).toHaveBeenCalledWith('testuser', 'password123');
      expect(result).toEqual(mockUser);
    });
  });

  describe('login', () => {
    it('用户名不存在时应抛出 UnauthorizedException', async () => {
      jest.spyOn(userService, 'findOneByUsername').mockResolvedValue(null);

      await expect(
        authService.login('nonexistent', 'password123'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('密码错误时应抛出 UnauthorizedException', async () => {
      const storedPassword = mockHashPassword('correct_password');
      const mockUser = {
        id: 'uuid',
        username: 'testuser',
        password: storedPassword,
      } as User;
      jest.spyOn(userService, 'findOneByUsername').mockResolvedValue(mockUser);

      await expect(
        authService.login('testuser', 'wrong_password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('密码正确时应成功登录并返回 accessToken', async () => {
      const storedPassword = mockHashPassword('correct_password');
      const mockUser = {
        id: 'uuid',
        username: 'testuser',
        password: storedPassword,
      } as User;
      jest.spyOn(userService, 'findOneByUsername').mockResolvedValue(mockUser);
      jest.spyOn(jwtService, 'signAsync').mockResolvedValue('mocked_jwt_token');

      const result = await authService.login('testuser', 'correct_password');

      expect(userService.findOneByUsername).toHaveBeenCalledWith('testuser');
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: 'uuid',
        username: 'testuser',
      });
      expect(result).toEqual({
        accessToken: 'mocked_jwt_token',
        user: {
          id: 'uuid',
          username: 'testuser',
        },
      });
    });
  });
});
