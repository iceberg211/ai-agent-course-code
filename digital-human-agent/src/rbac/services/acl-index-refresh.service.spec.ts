import { AclIndexRefreshService } from './acl-index-refresh.service';

function createRepo(overrides: Record<string, any> = {}) {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn(),
    ...overrides,
  };
}

describe('AclIndexRefreshService', () => {
  it('会根据文档可见范围和 ACL 规则刷新 chunk 权限字段', async () => {
    const execute = jest.fn().mockResolvedValue({ affected: 2 });
    const set = jest.fn().mockReturnThis();
    const where = jest.fn().mockReturnThis();
    const update = jest.fn().mockReturnValue({ set, where, execute });
    const chunkRepo = createRepo({
      createQueryBuilder: jest.fn().mockReturnValue({ update }),
    });
    const documentRepo = createRepo({
      findOne: jest.fn().mockResolvedValue({
        id: 'doc-1',
        visibility: 'department',
        department: '研发部',
        ownerId: 'owner-1',
      }),
    });
    const aclRepo = createRepo({
      find: jest.fn().mockResolvedValue([
        {
          subjectType: 'user',
          subjectId: 'u2',
          actions: ['read'],
          effect: 'allow',
        },
        {
          subjectType: 'role',
          subjectId: 'auditor',
          actions: ['manage'],
          effect: 'allow',
        },
      ]),
    });
    const service = new AclIndexRefreshService(
      documentRepo as any,
      chunkRepo as any,
      aclRepo as any,
      undefined as any,
    );

    const result = await service.refreshDocumentAclIndex('doc-1');

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedUserIds: ['u2'],
        allowedRoleIds: ['auditor'],
        allowedDepartmentIds: ['研发部'],
        securityLevel: 20,
        aclVersion: expect.any(Number),
      }),
    );
    expect(where).toHaveBeenCalledWith('document_id = :documentId', {
      documentId: 'doc-1',
    });
    expect(result.chunkCount).toBe(2);
  });
});
