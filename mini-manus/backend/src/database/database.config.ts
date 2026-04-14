const SSL_OPTIONS = { rejectUnauthorized: false } as const;

export function requireDatabaseUrl(
  value: string | undefined,
  envName: 'DATABASE_URL' | 'DIRECT_URL',
): string {
  if (!value) {
    throw new Error(`${envName} is required`);
  }

  return value;
}

export function createPostgresConnectionOptions(url: string) {
  return {
    type: 'postgres' as const,
    url,
    ssl: SSL_OPTIONS,
    /**
     * pg 连接池选项。
     *
     * keepAlive + keepAliveInitialDelay：开启 TCP 心跳，防止远端（Supabase/Neon）
     * 在空闲时单方面关闭连接，从而避免下次查询出现 ETIMEDOUT。
     *
     * connectionTimeoutMillis：连接池获取连接的超时时间，超过则快速失败。
     * idleTimeoutMillis：连接在池中空闲超过该时长会被主动回收，
     * 避免持有一个已被远端关闭的僵尸连接。
     *
     * statement_timeout（PostgreSQL 参数）：单条 SQL 执行超过 30 s 直接报错，
     * 防止慢查询无限挂起拖垮整个请求链路。
     */
    extra: {
      keepAlive: true,
      keepAliveInitialDelay: 10_000, // 10 s 后开始发 TCP 心跳
      connectionTimeoutMillis: 15_000, // 15 s 内拿不到连接则报错
      idleTimeoutMillis: 30_000, // 空闲 30 s 后回收连接
      options: '-c statement_timeout=30000', // 单条 SQL 最长 30 s
    },
  };
}
