import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { scryptSync, randomBytes } from 'node:crypto';
import { AuthService } from '@/auth/services/auth.service';
import { UserService } from '@/user/services/user.service';
import { User } from '@/user/entities/user.entity';

describe('AuthService', () => {
  let authService: AuthService;
  let userService: UserService;
  let jwtService: JwtService;
  let mockApiKeyRepo: any;

  const mockHashPassword = (password: string): string => {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  };

  beforeEach(() => {
    userService = {
      create: jest.fn(),
      findOne: jest.fn(),
      findOneByUsername: jest.fn(),
      updatePassword: jest.fn(),
    } as unknown as UserService;

    jwtService = {
      signAsync: jest.fn(),
    } as unknown as JwtService;

    mockApiKeyRepo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    authService = new AuthService(userService, jwtService, mockApiKeyRepo);
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

  describe('changePassword', () => {
    it('旧密码不匹配时应抛出 BadRequestException', async () => {
      const storedPassword = mockHashPassword('correct_password');
      const mockUser = {
        id: 'uuid',
        username: 'testuser',
        password: storedPassword,
      } as User;
      jest.spyOn(userService, 'findOne').mockResolvedValue(mockUser);

      await expect(
        authService.changePassword('uuid', 'wrong_password', 'new_password123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('旧密码正确时应成功更新密码并返回结果', async () => {
      const storedPassword = mockHashPassword('correct_password');
      const mockUser = {
        id: 'uuid',
        username: 'testuser',
        password: storedPassword,
      } as User;
      const updatedUser = {
        id: 'uuid',
        username: 'testuser',
      } as User;
      jest.spyOn(userService, 'findOne').mockResolvedValue(mockUser);
      jest.spyOn(userService, 'updatePassword').mockResolvedValue(updatedUser);

      const result = await authService.changePassword(
        'uuid',
        'correct_password',
        'new_password123',
      );

      expect(userService.findOne).toHaveBeenCalledWith('uuid');
      expect(userService.updatePassword).toHaveBeenCalledWith('uuid', 'new_password123');
      expect(result).toEqual(updatedUser);
    });
  });

  describe('createApiKey', () => {
    it('应该成功创建并返回 API Key', async () => {
      const mockApiKey = { id: 'key-id', name: 'my-key', key: 'dh_xxx', userId: 'user-id' };
      mockApiKeyRepo.create.mockReturnValue(mockApiKey);
      mockApiKeyRepo.save.mockResolvedValue(mockApiKey);

      const result = await authService.createApiKey('user-id', 'my-key');

      expect(mockApiKeyRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-id',
        name: 'my-key',
        key: expect.stringMatching(/^dh_[a-f0-9]+$/),
      }));
      expect(mockApiKeyRepo.save).toHaveBeenCalledWith(mockApiKey);
      expect(result).toEqual(mockApiKey);
    });
  });

  describe('listApiKeys', () => {
    it('应该返回用户所有有效的 API Key', async () => {
      const mockList = [{ id: 'key-id', name: 'my-key', isActive: true }];
      mockApiKeyRepo.find.mockResolvedValue(mockList);

      const result = await authService.listApiKeys('user-id');

      expect(mockApiKeyRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-id', isActive: true },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual(mockList);
    });
  });

  describe('revokeApiKey', () => {
    it('应该注销用户的 API Key', async () => {
      mockApiKeyRepo.update.mockResolvedValue({ affected: 1 });

      await authService.revokeApiKey('user-id', 'key-id');

      expect(mockApiKeyRepo.update).toHaveBeenCalledWith(
        { id: 'key-id', userId: 'user-id' },
        { isActive: false },
      );
    });
  });

  describe('validateApiKey', () => {
    it('若 API Key 无效应返回 null', async () => {
      mockApiKeyRepo.findOne.mockResolvedValue(null);

      const result = await authService.validateApiKey('dh_invalid');

      expect(mockApiKeyRepo.findOne).toHaveBeenCalledWith({
        where: { key: 'dh_invalid', isActive: true },
        relations: ['user'],
      });
      expect(result).toBeNull();
    });

    it('若 API Key 有效且关联用户存在应返回用户对象', async () => {
      const mockUser = { id: 'user-id', username: 'testuser', role: 'user' };
      const mockRecord = { id: 'key-id', key: 'dh_valid', user: mockUser };
      mockApiKeyRepo.findOne.mockResolvedValue(mockRecord);

      const result = await authService.validateApiKey('dh_valid');

      expect(result).toEqual(mockUser);
    });
  });
});
