import { createHash } from 'node:crypto';
import type { KnowledgeAccessScope } from '@/knowledge/types/knowledge-content.types';

/**
 * 检索缓存权限快照。
 * - 主体：owner/department/role
 * - 数据侧：per-KB aclEpoch（ACL 刷新时递增或取 max(acl_version)）
 */
export interface AclSnapshot {
  ownerId: string | null;
  department: string | null;
  role: string | null;
  /** knowledgeBaseId → epoch */
  aclEpochByKb: Record<string, number>;
}

export function buildAclSnapshot(
  scope?: KnowledgeAccessScope | null,
  aclEpochByKb: Record<string, number> = {},
): AclSnapshot {
  return {
    ownerId: scope?.ownerId?.trim() || null,
    department: scope?.department?.trim() || null,
    role: scope?.role?.trim() || null,
    aclEpochByKb: { ...aclEpochByKb },
  };
}

/** 稳定 hash，用于 cache key */
export function hashAclSnapshot(snapshot: AclSnapshot): string {
  const epochs = Object.keys(snapshot.aclEpochByKb)
    .sort()
    .map((kb) => `${kb}:${snapshot.aclEpochByKb[kb] ?? 0}`)
    .join('|');
  const raw = [
    snapshot.ownerId ?? '',
    snapshot.department ?? '',
    snapshot.role ?? '',
    epochs,
  ].join('#');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export function hashQueryKey(parts: string[]): string {
  return createHash('sha256')
    .update(parts.map((p) => p.trim()).join('\n'))
    .digest('hex')
    .slice(0, 24);
}
