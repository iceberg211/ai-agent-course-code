import {
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
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

      expect(userService.create).toHaveBeenCalledWith(
        'testuser',
        'password123',
        undefined,
      );
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
    it('应该成功创建 API Key，存储哈希并仅在创建结果返回明文', async () => {
      mockApiKeyRepo.create.mockImplementation((input: any) => ({
        id: 'key-id',
        isActive: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        ...input,
      }));
      mockApiKeyRepo.save.mockImplementation(async (input: any) => input);

      const result = await authService.createApiKey('user-id', 'my-key');

      expect(mockApiKeyRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-id',
        name: 'my-key',
        keyHash: expect.stringMatching(/^[a-f0-9]+:[a-f0-9]+$/),
        keyPrefix: expect.stringMatching(/^dh_[a-f0-9]{8}$/),
        keyLastFour: expect.stringMatching(/^[a-f0-9]{4}$/),
      }));
      expect(result.key).toMatch(/^dh_[a-f0-9]+$/);
      expect(result).not.toHaveProperty('keyHash');
    });
  });

  describe('listApiKeys', () => {
    it('应该返回用户所有有效 API Key 的安全摘要', async () => {
      const mockList = [
        {
          id: 'key-id',
          name: 'my-key',
          keyHash: 'secret',
          keyPrefix: 'dh_abcd1234',
          keyLastFour: '7890',
          isActive: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ];
      mockApiKeyRepo.find.mockResolvedValue(mockList);

      const result = await authService.listApiKeys('user-id');

      expect(mockApiKeyRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-id', isActive: true },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual([
        {
          id: 'key-id',
          name: 'my-key',
          keyPrefix: 'dh_abcd1234',
          keyLastFour: '7890',
          isActive: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);
      expect(result[0]).not.toHaveProperty('keyHash');
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

    it('注销不存在的 API Key 时应抛出 NotFoundException', async () => {
      mockApiKeyRepo.update.mockResolvedValue({ affected: 0 });

      await expect(authService.revokeApiKey('user-id', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('validateApiKey', () => {
    it('若 API Key 无效应返回 null', async () => {
      const invalidKey = 'dh_aaaaaaaaaaaaaaaa';
      mockApiKeyRepo.find.mockResolvedValue([]);

      const result = await authService.validateApiKey(invalidKey);

      expect(mockApiKeyRepo.find).toHaveBeenCalledWith({
        where: { keyPrefix: 'dh_aaaaaaaa', isActive: true },
        relations: ['user'],
      });
      expect(result).toBeNull();
    });

    it('若 API Key 有效且关联用户存在应返回用户对象', async () => {
      mockApiKeyRepo.create.mockImplementation((input: any) => ({
        id: 'key-id',
        isActive: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        ...input,
      }));
      mockApiKeyRepo.save.mockImplementation(async (input: any) => input);
      const mockUser = { id: 'user-id', username: 'testuser', role: 'user' };
      const created = await authService.createApiKey('user-id', 'my-key');
      const savedInput = mockApiKeyRepo.create.mock.calls.at(-1)?.[0];
      const mockRecord = {
        id: 'key-id',
        ...savedInput,
        user: mockUser,
      };
      mockApiKeyRepo.find.mockResolvedValue([mockRecord]);

      const result = await authService.validateApiKey(created.key);

      expect(result).toEqual(mockUser);
    });
  });
});
