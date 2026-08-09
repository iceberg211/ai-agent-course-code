/**
 * 带并发限制的异步 map 工具函数。
 *
 * 对 `items` 数组中的每一项依次分配给有限数量的 worker 并行执行 `mapper`，
 * 当某个 worker 完成当前项后会立即获取下一个待处理项，直到所有项处理完毕。
 *
 * @param items - 待处理的数据项数组
 * @param concurrency - 最大并发数量（至少为 1）
 * @param mapper - 异步映射函数，接收数据项和索引
 * @returns 按原数组顺序排列的结果数组
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    }),
  );

  return results;
}
