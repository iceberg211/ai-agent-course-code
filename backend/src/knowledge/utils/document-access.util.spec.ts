import { isDocumentVisibleToScope } from '@/knowledge/utils/document-access.util';

describe('document access util', () => {
  it('company 文档对普通用户可见', () => {
    expect(
      isDocumentVisibleToScope(
        { visibility: 'company', department: null, ownerId: null },
        { ownerId: 'u1', department: '财务部', role: 'user' },
      ),
    ).toBe(true);
  });

  it('department 文档只对同部门用户可见', () => {
    expect(
      isDocumentVisibleToScope(
        { visibility: 'department', department: '财务部', ownerId: null },
        { ownerId: 'u1', department: '财务部', role: 'user' },
      ),
    ).toBe(true);
    expect(
      isDocumentVisibleToScope(
        { visibility: 'department', department: '财务部', ownerId: null },
        { ownerId: 'u1', department: '法务部', role: 'user' },
      ),
    ).toBe(false);
  });

  it('private 文档只对 owner 或管理员可见', () => {
    expect(
      isDocumentVisibleToScope(
        { visibility: 'private', department: null, ownerId: 'u1' },
        { ownerId: 'u1', department: null, role: 'user' },
      ),
    ).toBe(true);
    expect(
      isDocumentVisibleToScope(
        { visibility: 'private', department: null, ownerId: 'u1' },
        { ownerId: 'u2', department: null, role: 'user' },
      ),
    ).toBe(false);
    expect(
      isDocumentVisibleToScope(
        { visibility: 'private', department: null, ownerId: 'u1' },
        { ownerId: 'admin', department: null, role: 'admin' },
      ),
    ).toBe(true);
  });
});
