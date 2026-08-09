/**
 * 分页参数标准化工具函数。
 * 提取自 ConversationService 和 KnowledgeDocumentService，消除重复实现（O-2 修复）。
 */

/**
 * 标准化页码，返回 >= 1 的整数。
 * 无效输入（NaN、Infinity、null、undefined）均返回 1。
 */
export function normalizePage(page: number | undefined): number {
  const value = Number(page ?? 1);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

/**
 * 标准化每页条数，限制在 [1, maxPageSize] 范围内。
 * 无效输入返回 defaultPageSize。
 */
export function normalizePageSize(
  pageSize: number | undefined,
  defaultPageSize = 20,
  maxPageSize = 100,
): number {
  const value = Number(pageSize ?? defaultPageSize);
  if (!Number.isFinite(value)) return defaultPageSize;
  return Math.min(Math.max(Math.floor(value), 1), maxPageSize);
}
