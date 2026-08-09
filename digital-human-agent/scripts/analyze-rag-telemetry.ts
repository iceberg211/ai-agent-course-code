/**
 * RAG 链路遥测分析（③ 数据基线）
 *
 * 扫描 conversation_message.rag_trace（jsonb），统计生产环境里 RAG 链路的真实使用情况：
 *  - stopReason 分布（单跳/多跳/联网/预算耗尽的实际占比）
 *  - degradationFlags 分布（各环节降级频率，验证"多跳几乎只在退化模式下运行"等假设）
 *  - 每轮 LLM 调用数分布（预算消耗画像）
 *  - 多跳 / 联网 / 记忆的实际使用率
 *  - 交叉：预算耗尽型 stopReason 中 evaluate 降级占比
 *
 * 用法：
 *   pnpm rag:telemetry [--days=30] [--profile=balanced_chat] [--json]
 *   --days    只统计最近 N 天（默认 30）
 *   --profile 只统计指定 profile（默认全部）
 *   --json    输出原始 JSON（供后续工具消费）
 */
import { existsSync, readFileSync } from 'node:fs';
import { Client } from 'pg';

interface RagTracePayload {
  strategy?: string;
  stopReason?: string;
  profileId?: string;
  degradationFlags?: string[];
  metrics?: {
    hops?: number;
    llmCalls?: number;
    embedCalls?: number;
    latencyMs?: number;
    firstTokenLatencyMs?: number | null;
    citationCount?: number;
  };
  webSearchUsed?: boolean;
  webSearchQueries?: string[];
  memory?: {
    shortTermWindowCount?: number;
    hasShortTermSummary?: boolean;
    longTermMemoryCount?: number;
  };
}

interface TraceRow {
  profileId: string;
  strategy: string;
  stopReason: string;
  degradationFlags: string[];
  hops: number;
  llmCalls: number;
  embedCalls: number;
  latencyMs: number;
  citationCount: number;
  webSearchUsed: boolean;
  webSearchQueryCount: number;
  shortTermWindowCount: number;
  longTermMemoryCount: number;
}

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  return (
    process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ??
    null
  );
}

function loadDotEnv(): void {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    if (process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[index];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function pct(count: number, total: number): string {
  if (total === 0) return '—';
  return `${((count / total) * 100).toFixed(1)}%`;
}

function parseTrace(raw: unknown): RagTracePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const trace = raw as Record<string, unknown>;
  // 兜底：取 report 或顶层字段（legacy 双写结构）
  const report =
    trace.report && typeof trace.report === 'object'
      ? (trace.report as Record<string, unknown>)
      : trace;
  const metrics =
    (report.metrics ?? trace.metrics) && typeof (report.metrics ?? trace.metrics) === 'object'
      ? ((report.metrics ?? trace.metrics) as Record<string, unknown>)
      : {};
  const memory =
    (trace.memory ?? report.memory) && typeof (trace.memory ?? report.memory) === 'object'
      ? ((trace.memory ?? report.memory) as Record<string, unknown>)
      : {};
  return {
    strategy: String(report.strategy ?? trace.strategy ?? ''),
    stopReason: String(report.stopReason ?? trace.stopReason ?? ''),
    profileId: String(report.profileId ?? trace.profileId ?? ''),
    degradationFlags: Array.isArray(
      report.degradationFlags ?? trace.degradationFlags,
    )
      ? (report.degradationFlags as unknown[]).map(String)
      : [],
    metrics: {
      hops: Number(metrics.hops ?? 0),
      llmCalls: Number(metrics.llmCalls ?? 0),
      embedCalls: Number(metrics.embedCalls ?? 0),
      latencyMs: Number(metrics.latencyMs ?? 0),
      citationCount: Number(metrics.citationCount ?? 0),
    },
    webSearchUsed: Boolean(trace.webSearchUsed ?? report.webSearchUsed),
    webSearchQueries: Array.isArray(trace.webSearchQueries)
      ? (trace.webSearchQueries as unknown[]).map(String)
      : [],
    memory: {
      shortTermWindowCount: Number(memory.shortTermWindowCount ?? 0),
      hasShortTermSummary: Boolean(memory.hasShortTermSummary),
      longTermMemoryCount: Number(memory.longTermMemoryCount ?? 0),
    },
  };
}

function formatSummary(rows: TraceRow[], jsonOnly: boolean): void {
  const total = rows.length;
  const byProfile = new Map<string, TraceRow[]>();
  for (const row of rows) {
    const bucket = byProfile.get(row.profileId) ?? [];
    bucket.push(row);
    byProfile.set(row.profileId, bucket);
  }

  const summarize = (label: string, items: TraceRow[]): void => {
    const n = items.length;
    if (n === 0) {
      console.log(`\n## ${label}：无数据`);
      return;
    }
    console.log(`\n## ${label}（${n} 轮）`);

    // stopReason 分布
    const stopReasonCount = new Map<string, number>();
    for (const row of items) {
      stopReasonCount.set(row.stopReason, (stopReasonCount.get(row.stopReason) ?? 0) + 1);
    }
    console.log('\n### stopReason 分布');
    console.log('| stopReason | 轮数 | 占比 |');
    console.log('|---|---|---|');
    for (const [reason, count] of [...stopReasonCount.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`| ${reason || '(空)'} | ${count} | ${pct(count, n)} |`);
    }

    // degradationFlags 分布
    const flagCount = new Map<string, number>();
    for (const row of items) {
      for (const flag of row.degradationFlags) {
        flagCount.set(flag, (flagCount.get(flag) ?? 0) + 1);
      }
    }
    console.log('\n### degradationFlags 分布');
    if (flagCount.size === 0) {
      console.log('（无降级）');
    } else {
      console.log('| flag | 轮数 | 占比 |');
      console.log('|---|---|---|');
      for (const [flag, count] of [...flagCount.entries()].sort(
        (a, b) => b[1] - a[1],
      )) {
        console.log(`| ${flag} | ${count} | ${pct(count, n)} |`);
      }
    }

    // LLM 调用数
    const llmCalls = items.map((r) => r.llmCalls).sort((a, b) => a - b);
    console.log('\n### 每轮 LLM 调用数');
    console.log(
      `均值 ${mean(llmCalls).toFixed(1)}｜中位 ${percentile(llmCalls, 0.5)}｜P90 ${percentile(llmCalls, 0.9)}｜最大 ${llmCalls[llmCalls.length - 1] ?? 0}`,
    );
    const buckets = [
      ['0-2', (v: number) => v <= 2],
      ['3-4', (v: number) => v > 2 && v <= 4],
      ['5-6', (v: number) => v > 4 && v <= 6],
      ['7+', (v: number) => v > 6],
    ] as const;
    console.log('| 档位 | 轮数 | 占比 |');
    console.log('|---|---|---|');
    for (const [label, test] of buckets) {
      const count = items.filter((r) => test(r.llmCalls)).length;
      console.log(`| ${label} | ${count} | ${pct(count, n)} |`);
    }

    // 多跳 / 联网 / 记忆使用率
    const multiHop = items.filter((r) => r.hops >= 2).length;
    const complexStrategy = items.filter((r) => r.strategy === 'complex').length;
    const webUsed = items.filter((r) => r.webSearchUsed).length;
    const withShortTerm = items.filter((r) => r.shortTermWindowCount > 0).length;
    const withLongTerm = items.filter((r) => r.longTermMemoryCount > 0).length;
    console.log('\n### 链路环节使用率');
    console.log('| 环节 | 轮数 | 占比 |');
    console.log('|---|---|---|');
    console.log(`| 多跳（hops>=2） | ${multiHop} | ${pct(multiHop, n)} |`);
    console.log(`| complex 策略 | ${complexStrategy} | ${pct(complexStrategy, n)} |`);
    console.log(`| 联网补充 | ${webUsed} | ${pct(webUsed, n)} |`);
    console.log(`| 命中短期记忆 | ${withShortTerm} | ${pct(withShortTerm, n)} |`);
    console.log(`| 命中长期记忆 | ${withLongTerm} | ${pct(withLongTerm, n)} |`);

    // 交叉：预算耗尽型 stopReason 里 evaluate 降级占比（验证多跳退化假设）
    const budgetExhaustedReasons = [
      'max_hops_reached',
      'multi_hop_insufficient',
      'sub_questions_exhausted',
    ];
    const budgetExhausted = items.filter((r) =>
      budgetExhaustedReasons.includes(r.stopReason),
    );
    if (budgetExhausted.length > 0) {
      const withEvaluateDegrade = budgetExhausted.filter((r) =>
        r.degradationFlags.includes('evaluate_heuristic'),
      ).length;
      console.log('\n### 预算不足型 stopReason × evaluate 降级');
      console.log(
        `预算不足 ${budgetExhausted.length} 轮（${pct(budgetExhausted.length, n)}），其中 evaluate 降级 ${withEvaluateDegrade} 轮（${pct(withEvaluateDegrade, budgetExhausted.length)}）`,
      );
    }

    // 延迟
    const latencies = items.map((r) => r.latencyMs).filter((v) => v > 0).sort((a, b) => a - b);
    if (latencies.length > 0) {
      console.log('\n### 端到端延迟（ms）');
      console.log(
        `均值 ${mean(latencies).toFixed(0)}｜中位 ${percentile(latencies, 0.5)}｜P90 ${percentile(latencies, 0.9)}`,
      );
    }
  };

  summarize('全量遥测', rows);
  for (const [profileId, profileRows] of byProfile) {
    summarize(`profile=${profileId}`, profileRows);
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const days = Number(readArg('days') ?? '30');
  const profileFilter = readArg('profile');
  const jsonOnly = process.argv.includes('--json');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('缺少 DATABASE_URL 环境变量（.env 中配置）');
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const params: unknown[] = [];
    let where = `"rag_trace" IS NOT NULL`;
    if (days > 0) {
      params.push(days);
      where += ` AND "created_at" >= now() - make_interval(days => $${params.length})`;
    }
    if (profileFilter) {
      params.push(profileFilter);
      where += ` AND "rag_trace"->>'profileId' = $${params.length}`;
    }
    const result = await client.query<{ rag_trace: unknown; created_at: Date }>(
      `SELECT "rag_trace", "created_at"
       FROM conversation_message
       WHERE ${where}
       ORDER BY "created_at" ASC`,
      params,
    );

    const rows: TraceRow[] = [];
    for (const record of result.rows) {
      const trace = parseTrace(record.rag_trace);
      if (!trace) continue;
      rows.push({
        profileId: trace.profileId || 'legacy',
        strategy: trace.strategy || '',
        stopReason: trace.stopReason || '',
        degradationFlags: trace.degradationFlags ?? [],
        hops: trace.metrics?.hops ?? 0,
        llmCalls: trace.metrics?.llmCalls ?? 0,
        embedCalls: trace.metrics?.embedCalls ?? 0,
        latencyMs: trace.metrics?.latencyMs ?? 0,
        citationCount: trace.metrics?.citationCount ?? 0,
        webSearchUsed: trace.webSearchUsed === true,
        webSearchQueryCount: trace.webSearchQueries?.length ?? 0,
        shortTermWindowCount: trace.memory?.shortTermWindowCount ?? 0,
        longTermMemoryCount: trace.memory?.longTermMemoryCount ?? 0,
      });
    }

    const first = result.rows[0]?.created_at;
    const last = result.rows[result.rows.length - 1]?.created_at;
    console.log(
      `RAG 遥测分析：${rows.length} 条有效记录（${days > 0 ? `最近 ${days} 天` : '全部时间'}${profileFilter ? `，profile=${profileFilter}` : ''}）`,
    );
    if (first && last) {
      console.log(`时间范围：${first.toISOString().slice(0, 10)} ~ ${last.toISOString().slice(0, 10)}`);
    }

    if (jsonOnly) {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      formatSummary(rows, false);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('遥测分析失败：', error);
  process.exitCode = 1;
});
