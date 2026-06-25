import { Brackets, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import type { KnowledgeAccessScope } from '@/knowledge/types/knowledge-content.types';

export function applyDocumentAccessScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  scope?: KnowledgeAccessScope,
): SelectQueryBuilder<T> {
  if (!scope || scope.role === 'admin') return qb;

  const ownerId = scope.ownerId?.trim();
  const department = scope.department?.trim();

  qb.andWhere(
    new Brackets((where) => {
      where.where(`${alias}.visibility = 'company'`);
      if (department) {
        where.orWhere(
          `(${alias}.visibility = 'department' AND ${alias}.department = :accessDepartment)`,
          { accessDepartment: department },
        );
      }
      if (ownerId) {
        where.orWhere(
          `(${alias}.visibility = 'private' AND ${alias}.owner_id = :accessOwnerId)`,
          { accessOwnerId: ownerId },
        );
      }
    }),
  );

  return qb;
}

export function isDocumentVisibleToScope(
  document: Pick<KnowledgeDocument, 'visibility' | 'department' | 'ownerId'>,
  scope?: KnowledgeAccessScope,
): boolean {
  if (!scope || scope.role === 'admin') return true;
  if (document.visibility === 'company') return true;
  if (document.visibility === 'department') {
    return Boolean(scope.department && document.department === scope.department);
  }
  return Boolean(scope.ownerId && document.ownerId === scope.ownerId);
}
