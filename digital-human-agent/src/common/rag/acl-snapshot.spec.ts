import {
  buildAclSnapshot,
  hashAclSnapshot,
  hashQueryKey,
} from '@/common/rag/acl-snapshot';

describe('acl-snapshot', () => {
  it('主体或 epoch 变化会改变 hash', () => {
    const a = buildAclSnapshot(
      { ownerId: 'u1', department: 'd1', role: 'user' },
      { kb1: 1 },
    );
    const b = buildAclSnapshot(
      { ownerId: 'u1', department: 'd1', role: 'user' },
      { kb1: 2 },
    );
    const c = buildAclSnapshot(
      { ownerId: 'u2', department: 'd1', role: 'user' },
      { kb1: 1 },
    );
    expect(hashAclSnapshot(a)).not.toBe(hashAclSnapshot(b));
    expect(hashAclSnapshot(a)).not.toBe(hashAclSnapshot(c));
    expect(hashAclSnapshot(a)).toBe(
      hashAclSnapshot(
        buildAclSnapshot(
          { ownerId: 'u1', department: 'd1', role: 'user' },
          { kb1: 1 },
        ),
      ),
    );
  });

  it('query key 稳定', () => {
    expect(hashQueryKey(['a', 'b'])).toBe(hashQueryKey(['a', 'b']));
    expect(hashQueryKey(['a', 'b'])).not.toBe(hashQueryKey(['a', 'c']));
  });
});
