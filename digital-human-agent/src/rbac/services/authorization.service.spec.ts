import { AuthorizationService } from './authorization.service';

function createRepo(overrides: Record<string, any> = {}) {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('AuthorizationService', () => {
  it('旧 admin 角色拥有所有权限', async () => {
    const service = new AuthorizationService(
      createRepo() as any,
      createRepo() as any,
      createRepo() as any,
      createRepo() as any,
      createRepo() as any,
      createRepo() as any,
      createRepo() as any,
    );

    await expect(
      service.hasPermission({ id: 'u1', role: 'admin' }, 'system:role-manage'),
    ).resolves.toBe(true);
  });

  it('能合并旧角色和 user_role 关系中的角色权限', async () => {
    const roleRepo = createRepo({
      find: jest.fn().mockResolvedValue([
        { id: 'role-user', code: 'user' },
        { id: 'role-editor', code: 'editor' },
      ]),
    });
    const userRoleRepo = createRepo({
      find: jest.fn().mockResolvedValue([
        { role: { id: 'role-editor', code: 'editor', name: '编辑' } },
      ]),
    });
    const rolePermissionRepo = createRepo({
      find: jest.fn().mockResolvedValue([
        { permission: { code: 'documents:view' } },
        { permission: { code: 'documents:upload' } },
      ]),
    });
    const service = new AuthorizationService(
      roleRepo as any,
      createRepo() as any,
      userRoleRepo as any,
      rolePermissionRepo as any,
      createRepo() as any,
      createRepo() as any,
      createRepo() as any,
    );

    await expect(
      service.hasPermission({ id: 'u1', role: 'user' }, 'documents:upload'),
    ).resolves.toBe(true);
    await expect(service.getUserRoleCodes({ id: 'u1', role: 'user' })).resolves.toEqual([
      'user',
      'editor',
    ]);
  });

  it('ACL deny 优先于基础可见范围', async () => {
    const documentAclRepo = createRepo({
      find: jest.fn().mockResolvedValue([
        {
          subjectType: 'user',
          subjectId: 'u1',
          actions: ['read'],
          effect: 'deny',
        },
      ]),
    });
    const service = new AuthorizationService(
      createRepo() as any,
      createRepo() as any,
      createRepo() as any,
      createRepo() as any,
      createRepo() as any,
      documentAclRepo as any,
      createRepo() as any,
    );

    await expect(
      service.canAccessDocument(
        { id: 'u1', role: 'user', department: '研发部' },
        {
          documentId: 'doc1',
          visibility: 'company',
          ownerId: null,
          department: null,
        },
      ),
    ).resolves.toBe(false);
  });
});
