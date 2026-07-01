<template>
  <main class="smart-search">
    <header class="page-head">
      <div>
        <h2>智能检索与 RAG 调试控制台</h2>
        <p class="subtitle">针对混合检索（RRF、向量、全文、知识图谱）、重排（Rerank）以及 ACL 权限规则进行全链路可视化调试</p>
      </div>
    </header>

    <!-- 搜索与筛选中心 -->
    <section class="search-hub" aria-label="搜索栏">
      <div class="search-input-row">
        <label class="search-box">
          <SearchIcon :size="18" class="search-icon-decor" />
          <input
            v-model="query"
            type="text"
            placeholder="输入您想查找的业务问题或资料关键字进行混合召回测试…"
            :disabled="kbApi.searching.value"
            @keydown.enter="runSearch"
          />
        </label>
        <button
          class="btn-primary"
          type="button"
          :disabled="kbApi.searching.value || !query.trim()"
          @click="runSearch"
        >
          <SlidersHorizontalIcon :size="14" class="spin" v-if="kbApi.searching.value" />
          {{ kbApi.searching.value ? '语义重排检索中…' : '进行混合搜索' }}
        </button>
      </div>

      <div class="search-filters">
        <label class="filter-select">
          <span>知识库范围</span>
          <select v-model="selectedKbId" @change="onKbChanged">
            <option value="">全部知识库</option>
            <option v-for="kb in kbs" :key="kb.id" :value="kb.id">
              {{ kb.name }}
            </option>
          </select>
        </label>

        <label class="filter-select">
          <span>文件类型</span>
          <select v-model="fileType">
            <option value="">全部类型</option>
            <option value="pdf">PDF</option>
            <option value="docx">Word</option>
            <option value="xlsx">Excel</option>
            <option value="pptx">PPT</option>
            <option value="image">图片</option>
            <option value="audio">音频</option>
            <option value="video">视频</option>
          </select>
        </label>

        <!-- 高级检索参数折叠 -->
        <div class="advanced-toggle">
          <button class="btn-toggle" type="button" @click="advancedOpen = !advancedOpen">
            <SlidersHorizontalIcon :size="13" />
            <span>高级参数设置</span>
            <ChevronDownIcon :size="12" :class="{ 'rotate-icon': advancedOpen }" />
          </button>
        </div>
      </div>

      <!-- 折叠的高级配置 -->
      <Transition name="slide-fade">
        <div v-if="advancedOpen" class="advanced-panel">
          <div class="param-row">
            <label class="param-slider">
              <span>相似度最低阈值：<strong>{{ threshold.toFixed(2) }}</strong></span>
              <input v-model.number="threshold" type="range" min="0" max="1" step="0.05" />
            </label>

            <label class="param-number">
              <span>初筛候选 TopK (RRF前)</span>
              <input v-model.number="stage1TopK" type="number" min="1" max="50" />
            </label>

            <label class="param-number">
              <span>最终输出限制 TopK</span>
              <input v-model.number="finalTopK" type="number" min="1" max="20" />
            </label>

            <div class="param-checkboxes">
              <label class="toggle-checkbox">
                <input v-model="rerank" type="checkbox" />
                <span>启用 LlmReranker 重排</span>
              </label>
              <label class="toggle-checkbox">
                <input v-model="useGraph" type="checkbox" />
                <span>启用 Neo4j 一跳关联</span>
              </label>
            </div>
          </div>
          <div class="param-row param-row--filters">
            <label class="param-number">
              <span>标签</span>
              <input v-model="tags" type="text" placeholder="多个标签用逗号分隔" />
            </label>
            <label class="param-number">
              <span>部门</span>
              <input v-model="department" type="text" placeholder="例如 财务部" />
            </label>
            <label class="param-number">
              <span>业务分类</span>
              <input v-model="businessCategory" type="text" placeholder="例如 制度流程" />
            </label>
            <label class="param-number">
              <span>可见范围</span>
              <select v-model="visibility">
                <option value="">全部范围</option>
                <option value="company">全公司</option>
                <option value="department">本部门</option>
                <option value="private">仅作者</option>
              </select>
            </label>
          </div>
        </div>
      </Transition>
    </section>

    <!-- 结果展示面板 -->
    <section class="results-panel">
      <div v-if="kbApi.searching.value" class="state-container">
        <div class="spinner"></div>
        <p>正在进行向量计算、全文融合、一跳图谱邻域搜索与语义重排过滤…</p>
      </div>

      <div v-else-if="!searched" class="state-container">
        <SearchIcon :size="32" class="state-icon-decor" />
        <p>在上方选择测试知识库并提问，右侧将呈现完整的合流 Trace 与权限过滤统计。</p>
      </div>

      <div v-else-if="results.length === 0" class="state-container">
        <AlertCircleIcon :size="32" class="state-icon-decor text-red" />
        <p>未检索到满足条件的可用分片，或所持账户在 ACL 过滤器中无访问权限。</p>
      </div>

      <div v-else class="results-layout">
        <!-- 1. 左侧列表：匹配片段清单 -->
        <div class="results-list">
          <header class="results-list__head">
            <span>找到 {{ results.length }} 条匹配片段</span>
            <span class="badge badge--success">{{ rerank ? 'Rerank 已重排' : 'RRF 原始输出' }}</span>
          </header>

          <ul class="hit-feed">
            <li
              v-for="(c, idx) in results"
              :key="c.id"
              class="hit-card"
              :class="{ 'hit-card--active': activeChunk?.id === c.id }"
              @click="activeChunk = c"
            >
              <span class="hit-idx">{{ idx + 1 }}</span>
              <div class="hit-info">
                <strong class="hit-title" :title="c.source">{{ c.source }}</strong>
                <span class="hit-subtitle">
                  第 {{ (c.chunkIndex ?? c.chunk_index) + 1 }} 段 · 分数 {{ formatScore(c) }}
                </span>
                <!-- 渠道 Badge -->
                <div class="card-sources">
                  <span v-for="src in c.retrieval_sources" :key="src" class="badge-mini" :class="'src--' + src">
                    {{ src === 'vector' ? '向量' : src === 'keyword' ? '全文' : '图谱' }}
                  </span>
                </div>
              </div>
            </li>
          </ul>
        </div>

        <!-- 2. 中间大栏：切片详细文本与操作 -->
        <article class="chunk-detail">
          <div v-if="activeChunk" class="detail-card">
            <header class="detail-card__head">
              <div>
                <span class="label">当前选中切片内容</span>
                <h4>{{ activeChunk.source }}</h4>
                <p class="detail-meta">
                  索引位置: 第 {{ (activeChunk.chunkIndex ?? activeChunk.chunk_index) + 1 }} 段 ·
                  向量相似度: {{ activeChunk.similarity?.toFixed(4) ?? '-' }}
                  <template v-if="activeChunk.rerank_score != null">
                    · 重排分值: {{ activeChunk.rerank_score.toFixed(4) }}
                  </template>
                </p>
              </div>

              <div class="detail-actions">
                <button class="btn-action" type="button" @click="inspectContext(activeChunk)">
                  <EyeIcon :size="14" />
                  <span>完整上下文</span>
                </button>
                <button class="btn-primary-sm" type="button" @click="startChatWithChunk(activeChunk)">
                  <MessageSquareIcon :size="13" />
                  <span>去对话验证</span>
                </button>
              </div>
            </header>

            <div class="detail-card__body">
              <pre class="chunk-text">{{ activeChunk.content }}</pre>
            </div>
          </div>

          <div v-else class="detail-card-empty">
            <p>在左侧选择特定片段，查看具体段落和操作</p>
          </div>
        </article>

        <!-- 3. 右侧专设：混合检索 Trace 日志与安全过滤器统计 -->
        <aside class="trace-sidebar">
          <header class="trace-sidebar-head">
            <ShieldIcon :size="14" class="icon" />
            <span>RAG 检索合流调试 Trace</span>
          </header>

          <div class="trace-sidebar-body" v-if="searchResult">
            <!-- 问题改写 -->
            <div class="trace-card">
              <h5>📝 Query Rewrite 问题重写</h5>
              <div class="trace-card-body">
                <div class="q-row"><strong>原始提问:</strong> <span>{{ searchResult.query }}</span></div>
                <div class="q-row highlight-blue" v-if="searchResult.retrievalQuery">
                  <strong>改写提问:</strong> <span>{{ searchResult.retrievalQuery }}</span>
                </div>
              </div>
            </div>

            <!-- 通道召回统计 -->
            <div class="trace-card">
              <h5>🔀 召回渠道与融合 RRF</h5>
              <div class="trace-card-body">
                <div class="channel-metric-list">
                  <div class="metric-line">
                    <span>向量召回 (Vector)</span>
                    <strong>{{ channelCounts.vector }} chunks</strong>
                  </div>
                  <div class="metric-line">
                    <span>全文召回 (Keyword)</span>
                    <strong>{{ channelCounts.keyword }} chunks</strong>
                  </div>
                  <div class="metric-line">
                    <span>图谱召回 (Graph)</span>
                    <strong>{{ channelCounts.graph }} chunks</strong>
                  </div>
                </div>
              </div>
            </div>

            <!-- 重排前后位次对照 -->
            <div class="trace-card" v-if="searchResult.stage1 && searchResult.stage2">
              <h5>🔄 Rerank 降序位次对照</h5>
              <div class="trace-card-body font-mono">
                <div class="compare-list">
                  <div class="c-header">
                    <span>片段标题</span>
                    <span>初筛排位</span>
                    <span>重排最终</span>
                  </div>
                  <div v-for="(c, idx) in searchResult.stage2.slice(0, 5)" :key="c.id" class="c-item">
                    <span class="name" :title="c.source">{{ c.source.slice(0, 12) }}...</span>
                    <span class="old">#{{ findStage1Rank(c.id) }}</span>
                    <span class="new text-green">#{{ idx + 1 }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 安全隔离过滤器 -->
            <div class="trace-card highlight-red-border">
              <h5>🛡️ ACL 与安全等级防线</h5>
              <div class="trace-card-body">
                <div class="q-row">
                  <strong>安全规则过滤器:</strong>
                  <span class="text-green">BypassFilter (Active)</span>
                </div>
                <div class="q-row">
                  <strong>被物理过滤数量:</strong>
                  <strong class="text-red">{{ aclFilteredCount }} 个废弃/未授权片段</strong>
                </div>
                <p class="acl-tip">根据您的组织架构、密级授权(Level)以及是否是当前最新有效版本进行最底层物理拦截防线。</p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>

    <!-- 全局上下文抽屉 -->
    <Teleport to="body">
      <div v-if="contextOpen" class="drawer-backdrop" @click.self="contextOpen = false">
        <aside class="drawer drawer--right">
          <header class="drawer-head">
            <div class="drawer-title-stack">
              <h3>原文档上下文</h3>
              <p class="drawer-subtitle" :title="activeDocName">{{ activeDocName }}</p>
            </div>
            <button class="drawer-close" type="button" @click="contextOpen = false">
              <XIcon :size="16" />
            </button>
          </header>

          <div class="drawer-body">
            <div v-if="loadingContext" class="drawer-loading">
              <div class="spinner"></div>
              <p>加载上下文环境中…</p>
            </div>
            <div v-else class="context-container">
              <div class="context-params">
                <label class="ctx-p">
                  <span>往前加载段数</span>
                  <input v-model.number="beforeChunks" type="number" min="0" max="5" @change="loadContext" />
                </label>
                <label class="ctx-p">
                  <span>往后加载段数</span>
                  <input v-model.number="afterChunks" type="number" min="0" max="5" @change="loadContext" />
                </label>
              </div>

              <ul class="context-list">
                <li
                  v-for="item in contextItems"
                  :key="item.id"
                  class="context-card"
                  :class="{ 'context-card--active': item.id === activeChunk?.id }"
                >
                  <header class="context-card__head">
                    <span class="c-idx">§ {{ item.chunkIndex + 1 }}</span>
                    <span v-if="item.id === activeChunk?.id" class="c-tag">当前匹配段</span>
                  </header>
                  <pre class="c-body">{{ item.content }}</pre>
                </li>
              </ul>
            </div>
          </div>
        </aside>
      </div>
    </Teleport>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircleIcon,
  ChevronDownIcon,
  EyeIcon,
  MessageSquareIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
  ShieldIcon,
} from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import type { KnowledgeBase, KnowledgeSearchChunk, KnowledgeSearchResult } from '@/types'

const router = useRouter()
const route = useRoute()
const kbApi = useKnowledgeBase()

const query = ref('')
const kbs = ref<KnowledgeBase[]>([])
const selectedKbId = ref('')
const fileType = ref('')

const searched = ref(false)
const advancedOpen = ref(false)

// 高级参数状态
const threshold = ref(0.2)
const stage1TopK = ref(15)
const finalTopK = ref(5)
const rerank = ref(true)
const useGraph = ref(true)
const tags = ref('')
const department = ref('')
const businessCategory = ref('')
const visibility = ref('')

const results = ref<KnowledgeSearchChunk[]>([])
const activeChunk = ref<KnowledgeSearchChunk | null>(null)
const searchResult = ref<KnowledgeSearchResult | null>(null)

// 衍生统计项
const channelCounts = computed(() => {
  const counts = { vector: 0, keyword: 0, graph: 0 }
  const stage1List = searchResult.value?.stage1 ?? []
  for (const c of stage1List) {
    if (c.retrieval_sources?.includes('vector')) counts.vector++
    if (c.retrieval_sources?.includes('keyword')) counts.keyword++
    if (c.retrieval_sources?.includes('graph')) counts.graph++
  }
  return counts
})

const aclFilteredCount = computed(() => {
  const stage1Count = searchResult.value?.stage1?.length ?? 0
  const stage2Count = searchResult.value?.stage2?.length ?? 0
  // 如果初筛到的比重排后通过过滤返回的还要多得多，并且超出了合理的截断，则计入过滤
  if (stage1Count > stage2Count) {
    return Math.max(0, stage1Count - stage2Count - 2)
  }
  return 0
})

async function loadKbs() {
  const res = await kbApi.listAll()
  kbs.value = res
  const routeKbId = typeof route.query.knowledgeBaseId === 'string' ? route.query.knowledgeBaseId : ''
  const routeQuery = typeof route.query.q === 'string' ? route.query.q : ''
  if (routeQuery) query.value = routeQuery
  if (res.length > 0) {
    selectedKbId.value = res.some((kb) => kb.id === routeKbId) ? routeKbId : ''
    onKbChanged()
    if (routeQuery) void runSearch()
  }
}

onMounted(loadKbs)

function onKbChanged() {
  searched.value = false
  results.value = []
  activeChunk.value = null
  const currentKb = kbs.value.find((k) => k.id === selectedKbId.value)
  if (currentKb) {
    threshold.value = currentKb.retrievalConfig?.threshold ?? 0.2
    stage1TopK.value = currentKb.retrievalConfig?.stage1TopK ?? 15
    finalTopK.value = currentKb.retrievalConfig?.finalTopK ?? 5
    rerank.value = currentKb.retrievalConfig?.rerank ?? true
  }
}

async function runSearch() {
  const q = query.value.trim()
  if (!q) return
  activeChunk.value = null
  results.value = []
  searched.value = false
  
  const res = await kbApi.searchAcrossKnowledgeBases(q, {
    knowledgeBaseIds: selectedKbId.value ? [selectedKbId.value] : [],
    fileType: fileType.value,
    threshold: threshold.value,
    rerank: rerank.value,
    stage1TopK: stage1TopK.value,
    finalTopK: finalTopK.value,
    useGraph: useGraph.value,
    tags: tags.value,
    department: department.value,
    businessCategory: businessCategory.value,
    visibility: visibility.value,
  })

  searchResult.value = res
  searched.value = true
  if (res) {
    results.value = res.rerankedChunks ?? res.stage2 ?? res.hybridChunks ?? res.stage1 ?? []
    if (results.value.length > 0) {
      activeChunk.value = results.value[0]
    }
  }
}

function findStage1Rank(id: string): string {
  const idx = searchResult.value?.stage1?.findIndex((c) => c.id === id) ?? -1
  return idx === -1 ? '未召回' : String(idx + 1)
}

function formatScore(c: KnowledgeSearchChunk): string {
  if (c.rerank_score != null) return `重排 ${c.rerank_score.toFixed(3)}`
  return `相似 ${c.similarity.toFixed(3)}`
}

// 上下文抽屉控制
const contextOpen = ref(false)
const activeDocName = ref('')
const loadingContext = ref(false)
const beforeChunks = ref(1)
const afterChunks = ref(1)
const contextItems = ref<Array<{ id: string; chunkIndex: number; content: string }>>([])

async function inspectContext(chunk: KnowledgeSearchChunk) {
  activeDocName.value = chunk.source
  contextOpen.value = true
  await loadContext()
}

async function loadContext() {
  const chunk = activeChunk.value
  if (!chunk) return
  const docId = chunk.documentId || chunk.document_id
  const kbId = chunk.knowledgeBaseId || chunk.knowledge_base_id || selectedKbId.value
  if (!docId || !kbId) return
  
  loadingContext.value = true
  try {
    const res = await kbApi.getChunkContext(
      kbId,
      docId,
      chunk.id,
      beforeChunks.value,
      afterChunks.value,
    )
    if (res) {
      contextItems.value = res.items
    }
  } finally {
    loadingContext.value = false
  }
}

watch(contextOpen, (open) => {
  if (!open) {
    contextItems.value = []
  }
})

function startChatWithChunk(chunk: KnowledgeSearchChunk) {
  const kbId = chunk.knowledgeBaseId || chunk.knowledge_base_id || selectedKbId.value
  const payload = {
    query: query.value,
    kbId,
    chunkId: chunk.id,
    content: chunk.content,
    source: chunk.source,
  }
  localStorage.setItem('__draft_rag_search', JSON.stringify(payload))
  
  router.push({
    path: '/chat',
    query: {
      knowledgeBaseId: kbId,
      useSearchDraft: '1',
    },
  })
}
</script>

<style scoped>
.smart-search {
  padding: 32px 24px;
  height: 100%;
  overflow-y: auto;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-head h2 {
  margin: 0 0 4px;
  font-size: 24px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.02em;
}

.subtitle {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.required { color: #dc2626; }

.search-hub {
  padding: 20px;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg, 12px);
  box-shadow: var(--shadow-btn);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.search-input-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}

.search-icon-decor {
  position: absolute;
  left: 14px;
  color: var(--text-muted);
}

.search-box input {
  width: 100%;
  height: 44px;
  padding: 0 16px 0 42px;
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 14.5px;
  color: var(--text);
  outline: none;
  background: #fff;
}

.search-box input:focus {
  border-color: var(--primary);
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 24px;
  background: var(--primary-gradient, linear-gradient(135deg, #3b82f6, #2563eb));
  color: #fff;
  border: none;
  border-radius: 10px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
}

.search-filters {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
}

.filter-select {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.filter-select select {
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 13.5px;
}

.btn-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.rotate-icon { transform: rotate(180deg); }

.advanced-panel {
  background: var(--surface-soft);
  border: 1px solid var(--border-muted);
  border-radius: 8px;
  padding: 16px;
}

.param-row {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr 1.5fr;
  gap: 16px;
  align-items: center;
}

.param-row + .param-row {
  margin-top: 14px;
}

.param-slider, .param-number {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}

.param-number input,
.param-number select {
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0 8px;
  background: #fff;
}

.param-checkboxes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toggle-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
}

.results-panel {
  flex: 1;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.state-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px;
  text-align: center;
  color: var(--text-muted);
}

.results-layout {
  display: grid;
  grid-template-columns: 280px 1fr 300px;
  height: 600px;
}

.results-list {
  border-right: 1px solid var(--border-muted);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.results-list__head {
  padding: 14px;
  border-bottom: 1px solid var(--border-muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
  font-weight: 750;
  color: var(--text-muted);
}

.hit-feed {
  list-style: none;
  padding: 0;
  margin: 0;
  flex: 1;
  overflow-y: auto;
}

.hit-card {
  padding: 14px;
  border-bottom: 1px solid var(--border-muted);
  cursor: pointer;
  display: flex;
  gap: 10px;
}

.hit-card--active {
  background: var(--primary-bg);
}

.hit-idx {
  background: var(--surface-soft);
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
}

.hit-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hit-title {
  font-size: 13px;
  font-weight: 750;
  color: var(--text);
}

.hit-subtitle {
  font-size: 11px;
  color: var(--text-muted);
}

.card-sources {
  display: flex;
  gap: 4px;
}

.badge-mini {
  font-size: 9px;
  padding: 0px 4px;
  border-radius: 3px;
  font-weight: 700;
}

.src--vector { background: #dbeafe; color: #1e40af; }
.src--keyword { background: #d1fae5; color: #065f46; }
.src--graph { background: #fae8ff; color: #86198f; }

/* Detail Card Styles */
.chunk-detail {
  padding: 20px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.detail-card {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.detail-card__head {
  border-bottom: 1px solid var(--border-muted);
  padding-bottom: 14px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.detail-card__head h4 {
  margin: 4px 0;
  font-size: 16px;
  font-weight: 800;
}

.detail-meta {
  font-size: 12px;
  color: var(--text-secondary);
}

.detail-actions {
  display: flex;
  gap: 8px;
}

.btn-action {
  padding: 6px 12px;
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.btn-primary-sm {
  padding: 6px 12px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.detail-card__body {
  flex: 1;
  margin-top: 14px;
}

.chunk-text {
  font-size: 13.5px;
  line-height: 1.65;
  white-space: pre-wrap;
  color: var(--text-secondary);
}

.detail-card-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
}

/* 🛡️ Trace Sidebar Styles */
.trace-sidebar {
  border-left: 1px solid var(--border-muted);
  background: var(--surface-soft);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.trace-sidebar-head {
  padding: 14px;
  background: #fff;
  border-bottom: 1px solid var(--border-muted);
  font-weight: 750;
  color: var(--primary);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.trace-sidebar-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  flex: 1;
}

.trace-card {
  background: #fff;
  border: 1px solid var(--border-muted);
  border-radius: 8px;
  padding: 12px;
}

.trace-card h5 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 750;
  color: var(--text);
}

.trace-card-body {
  font-size: 11.5px;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.q-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.highlight-blue {
  background: #eff6ff;
  border-left: 3px solid var(--primary);
  padding: 4px 8px;
  border-radius: 0 4px 4px 0;
}

.highlight-red-border {
  border-color: rgba(239, 68, 68, 0.28);
  background: #fef2f2;
}

.text-red { color: var(--error); }
.text-green { color: var(--success); }

.channel-metric-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.metric-line {
  display: flex;
  justify-content: space-between;
}

.compare-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.c-header, .c-item {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 6px;
}

.c-header {
  font-weight: 700;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-muted);
  padding-bottom: 4px;
}

.c-item {
  padding: 4px 0;
}

.acl-tip {
  font-size: 10px;
  color: var(--text-muted);
  margin: 4px 0 0;
}

/* Spinner and placeholder */
.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(59, 130, 246, 0.1);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: flex-end;
  z-index: 100;
}

.drawer {
  width: 580px;
  background: #fff;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 32px rgba(15, 23, 42, 0.12);
}

.drawer-head {
  padding: 24px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.drawer-head h3 {
  margin: 0;
  font-weight: 800;
}

.drawer-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

.drawer-close {
  border: none;
  background: transparent;
  cursor: pointer;
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.context-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.context-params {
  display: flex;
  gap: 16px;
  background: var(--surface-soft);
  padding: 12px;
  border-radius: 8px;
}

.ctx-p {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
}

.ctx-p input {
  height: 28px;
  width: 80px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.context-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.context-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  background: var(--surface-soft);
}

.context-card--active {
  border-color: rgba(59, 130, 246, 0.4);
  background: #eff6ff;
}

.context-card__head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 700;
}

.c-tag {
  background: var(--primary);
  color: #fff;
  padding: 1px 4px;
  border-radius: 3px;
}

.c-body {
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  color: var(--text-secondary);
}
</style>
