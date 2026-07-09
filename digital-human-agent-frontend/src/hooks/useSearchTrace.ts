import { computed, type Ref } from 'vue'
import type { KnowledgeSearchChunk, KnowledgeSearchResult } from '@/types'
import type { TraceBlock, TraceSummaryItem } from '@/components/common/TracePanel.vue'

export function channelLabel(channel: string): string {
  const labels: Record<string, string> = {
    vector: '向量召回',
    keyword: '全文召回',
    graph: '图谱召回',
    memory: '记忆召回',
    multimodal: '多模态召回',
    queryRewrite: '问题改写',
    rerank: '语义重排',
    permission: '权限过滤',
  }
  return labels[channel] ?? channel
}

export function channelBadgeClass(channel: string): string {
  const classes: Record<string, string> = {
    vector: 'bg-blue-100 text-blue-800',
    keyword: 'bg-emerald-100 text-emerald-800',
    graph: 'bg-purple-100 text-purple-800',
    memory: 'bg-amber-100 text-amber-800',
    multimodal: 'bg-cyan-100 text-cyan-800',
  }
  return classes[channel] ?? 'bg-slate-100 text-slate-700'
}

export function useSearchTrace(
  searchResult: Ref<KnowledgeSearchResult | null>,
  results: Ref<KnowledgeSearchChunk[]>,
) {
  const channelCounts = computed(() => {
    const stageChannels = searchResult.value?.stageTrace?.channels
    if (stageChannels) {
      return {
        vector: stageChannels.vector?.resultCount ?? 0,
        keyword: stageChannels.keyword?.resultCount ?? 0,
        graph: stageChannels.graph?.resultCount ?? 0,
      }
    }
    const counts = { vector: 0, keyword: 0, graph: 0 }
    for (const c of searchResult.value?.stage1 ?? []) {
      if (c.retrieval_sources?.includes('vector')) counts.vector++
      if (c.retrieval_sources?.includes('keyword')) counts.keyword++
      if (c.retrieval_sources?.includes('graph')) counts.graph++
    }
    return counts
  })

  const channelRows = computed(() => {
    const channels = searchResult.value?.stageTrace?.channels
    if (channels) {
      return Object.entries(channels).map(([key, trace]) => ({
        key,
        label: channelLabel(key),
        backend: trace.backend || 'disabled',
        resultCount: trace.resultCount ?? 0,
        skipped: trace.skipped || trace.backend === 'disabled',
      }))
    }
    return [
      { key: 'vector', label: '向量召回', backend: 'unknown', resultCount: channelCounts.value.vector, skipped: false },
      { key: 'keyword', label: '全文召回', backend: 'unknown', resultCount: channelCounts.value.keyword, skipped: false },
      { key: 'graph', label: '图谱召回', backend: 'unknown', resultCount: channelCounts.value.graph, skipped: false },
    ]
  })

  const rrfFusionCount = computed(() => searchResult.value?.stageTrace?.rrfFusion?.length ?? 0)
  const degradedChannels = computed(() => searchResult.value?.degradedChannels ?? [])

  const rewriteQueries = computed(() => {
    const trace = searchResult.value?.stageTrace as
      | {
          queryRewrite?: { rewrittenQuery?: string; queries?: string[]; retrievalQueries?: string[] }
          retrievalQueries?: string[]
        }
      | undefined
    const candidates = [
      searchResult.value?.retrievalQuery,
      trace?.queryRewrite?.rewrittenQuery,
      ...(trace?.queryRewrite?.queries ?? []),
      ...(trace?.queryRewrite?.retrievalQueries ?? []),
      ...(trace?.retrievalQueries ?? []),
    ]
    return Array.from(new Set(candidates.filter((item): item is string => Boolean(item?.trim()))))
  })

  const allChunks = computed(() => {
    const map = new Map<string, KnowledgeSearchChunk>()
    for (const chunk of [
      ...(searchResult.value?.hybridChunks ?? []),
      ...(searchResult.value?.rerankedChunks ?? []),
      ...(searchResult.value?.stage1 ?? []),
      ...(searchResult.value?.stage2 ?? []),
      ...results.value,
    ]) {
      map.set(chunk.id, chunk)
    }
    return map
  })

  const rrfTopRows = computed(() =>
    (searchResult.value?.stageTrace?.rrfFusion ?? []).slice(0, 5).map((item, index) => {
      const record = item as { chunkId?: string; id?: string; score?: number; rrfScore?: number }
      const chunkId = record.chunkId ?? record.id ?? String(index)
      const chunk = allChunks.value.get(chunkId)
      const score = record.rrfScore ?? record.score
      return {
        key: `${chunkId}-${index}`,
        rank: index + 1,
        source: chunk?.source ?? chunkId,
        score: typeof score === 'number' ? score.toFixed(4) : '-',
      }
    }),
  )

  const rerankTraceRows = computed(() =>
    (searchResult.value?.stageTrace?.rerank ?? []).map((item) => ({
      ...item,
      source: allChunks.value.get(item.chunkId)?.source ?? item.chunkId,
    })),
  )

  const aclFilteredCount = computed(() => {
    const stageFilter = searchResult.value?.stageTrace?.permissionFilter
    if (stageFilter) return stageFilter.filtered
    if (typeof searchResult.value?.permissionFilteredCount === 'number') {
      return searchResult.value.permissionFilteredCount
    }
    const stage1Count = searchResult.value?.stage1?.length ?? 0
    const stage2Count = searchResult.value?.stage2?.length ?? 0
    if (stage1Count > stage2Count) return Math.max(0, stage1Count - stage2Count - 2)
    return 0
  })

  const permissionFilter = computed(() => {
    const filter = searchResult.value?.stageTrace?.permissionFilter as
      | { strategy?: string; reason?: string; visibleScopes?: string[]; filtered?: number }
      | undefined
    const scopes = filter?.visibleScopes?.length
      ? `可见范围：${filter.visibleScopes.join('、')}`
      : '按用户、部门、可见范围与当前版本过滤。'
    return {
      strategy: filter?.strategy ?? 'ACL Filter',
      description: filter?.reason ?? scopes,
    }
  })

  const traceSummary = computed<TraceSummaryItem[]>(() => [
    { label: '改写问题', value: rewriteQueries.value.length || 0 },
    { label: '召回通道', value: channelRows.value.filter((row) => !row.skipped).length },
    { label: 'RRF 候选', value: rrfFusionCount.value || results.value.length },
    { label: '权限过滤', value: aclFilteredCount.value },
  ])

  const traceBlocks = computed<TraceBlock[]>(() => {
    const blocks: TraceBlock[] = [
      {
        key: 'rewrite',
        title: 'Query Rewrite',
        list: rewriteQueries.value.length
          ? rewriteQueries.value
          : ['后端未返回改写结果，将使用原始问题检索。'],
        description: searchResult.value?.query
          ? `原始提问：${searchResult.value.query}`
          : undefined,
      },
      {
        key: 'channels',
        title: '多路召回',
        rows: channelRows.value.map((row) => ({
          label: `${row.label} (${row.backend})`,
          value: `${row.resultCount} chunks`,
        })),
      },
    ]

    if (rrfTopRows.value.length) {
      blocks.push({
        key: 'rrf',
        title: 'RRF 融合 Top',
        rows: rrfTopRows.value.map((row) => ({
          label: `#${row.rank} ${row.source}`,
          value: row.score,
        })),
      })
    }

    if (rerankTraceRows.value.length) {
      blocks.push({
        key: 'rerank',
        title: 'Rerank 位次对照',
        rows: rerankTraceRows.value.slice(0, 5).map((row) => ({
          label: String(row.source).slice(0, 24),
          value: `#${row.beforeRank} → #${row.afterRank}`,
        })),
      })
    }

    if (degradedChannels.value.length) {
      blocks.push({
        key: 'degraded',
        title: '降级与回退',
        tone: 'warn',
        list: degradedChannels.value.map((item) => {
          const backend = item.backend ? ` / ${item.backend}` : ''
          return `${channelLabel(item.channel)}${backend}：${item.reason}`
        }),
      })
    }

    blocks.push({
      key: 'permission',
      title: '权限过滤',
      tone: aclFilteredCount.value > 0 ? 'danger' : 'default',
      rows: [
        { label: '过滤策略', value: permissionFilter.value.strategy },
        { label: '过滤数量', value: `${aclFilteredCount.value} 个` },
      ],
      description: permissionFilter.value.description,
    })

    return blocks
  })

  return {
    channelCounts,
    channelRows,
    rrfFusionCount,
    degradedChannels,
    rewriteQueries,
    rrfTopRows,
    rerankTraceRows,
    aclFilteredCount,
    permissionFilter,
    traceSummary,
    traceBlocks,
  }
}
