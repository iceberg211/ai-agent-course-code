<template>
  <main class="smart-search">
    <header class="page-head">
      <div>
        <h2>智能搜索</h2>
        <p class="subtitle">在企业知识库中快速精准检索定位分片资料</p>
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
            placeholder="输入您想查找的业务问题或资料关键字…"
            :disabled="kbApi.searching.value"
            @keydown.enter="runSearch"
          />
        </label>
        <button
          class="btn-primary"
          type="button"
          :disabled="kbApi.searching.value || !query.trim() || !selectedKbId"
          @click="runSearch"
        >
          {{ kbApi.searching.value ? '检索中…' : '进行搜索' }}
        </button>
      </div>

      <div class="search-filters">
        <label class="filter-select">
          <span>目标知识库 <span class="required">*</span></span>
          <select v-model="selectedKbId" @change="onKbChanged">
            <option value="" disabled>请选择要检索的知识库</option>
            <option v-for="kb in kbs" :key="kb.id" :value="kb.id">
              {{ kb.name }}
            </option>
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
              <span>相似度阈值：<strong>{{ threshold.toFixed(2) }}</strong></span>
              <input v-model.number="threshold" type="range" min="0" max="1" step="0.05" />
            </label>

            <label class="param-number">
              <span>初筛候选数 (TopK)</span>
              <input v-model.number="stage1TopK" type="number" min="1" max="50" />
            </label>

            <label class="param-number">
              <span>最终限制数</span>
              <input v-model.number="finalTopK" type="number" min="1" max="20" />
            </label>

            <label class="toggle-checkbox">
              <input v-model="rerank" type="checkbox" />
              <span>启用 Rerank 重排</span>
            </label>
          </div>
        </div>
      </Transition>
    </section>

    <!-- 结果展示面板 -->
    <section class="results-panel">
      <div v-if="kbApi.searching.value" class="state-container">
        <div class="spinner"></div>
        <p>正在进行语义匹配与重排筛选…</p>
      </div>

      <div v-else-if="!searched" class="state-container">
        <SearchIcon :size="32" class="state-icon-decor" />
        <p>请在上方选择知识库并输入问题，开启探索。</p>
      </div>

      <div v-else-if="results.length === 0" class="state-container">
        <AlertCircleIcon :size="32" class="state-icon-decor text-red" />
        <p>未能检索到相关内容。您可以尝试降低相似度阈值或更换查询词。</p>
      </div>

      <div v-else class="results-layout">
        <!-- 侧边大纲列表 -->
        <div class="results-list">
          <header class="results-list__head">
            <span>找到 {{ results.length }} 条匹配片段</span>
            <span class="badge badge--success">{{ rerank ? '重排优化' : '向量截断' }}</span>
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
              </div>
            </li>
          </ul>
        </div>

        <!-- 详细内容面板 -->
        <article class="chunk-detail">
          <div v-if="activeChunk" class="detail-card">
            <header class="detail-card__head">
              <div>
                <span class="label">当前选中分段</span>
                <h4>{{ activeChunk.source }}</h4>
                <p class="detail-meta">
                  第 {{ (activeChunk.chunkIndex ?? activeChunk.chunk_index) + 1 }} 段 ·
                  相似度 {{ activeChunk.similarity.toFixed(3) }}
                  <template v-if="activeChunk.rerank_score != null">
                    · 重排 {{ activeChunk.rerank_score.toFixed(3) }}
                  </template>
                </p>
              </div>

              <div class="detail-actions">
                <button class="btn-action" type="button" @click="inspectContext(activeChunk)">
                  <EyeIcon :size="14" />
                  <span>查看完整上下文</span>
                </button>
                <button class="btn-primary-sm" type="button" @click="startChatWithChunk(activeChunk)">
                  <MessageSquareIcon :size="13" />
                  <span>基于此问答验证</span>
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
      </div>
    </section>

    <!-- 全局上下文抽屉 -->
    <Teleport to="body">
      <div v-if="contextOpen" class="drawer-backdrop" @click.self="contextOpen = false">
        <aside class="drawer">
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
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircleIcon,
  ChevronDownIcon,
  EyeIcon,
  MessageSquareIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import type { KnowledgeBase, KnowledgeSearchChunk } from '@/types'

const router = useRouter()
const kbApi = useKnowledgeBase()

const query = ref('')
const kbs = ref<KnowledgeBase[]>([])
const selectedKbId = ref('')

const searched = ref(false)
const advancedOpen = ref(false)

// 高级参数状态
const threshold = ref(0.2)
const stage1TopK = ref(15)
const finalTopK = ref(5)
const rerank = ref(true)

const results = ref<KnowledgeSearchChunk[]>([])
const activeChunk = ref<KnowledgeSearchChunk | null>(null)

async function loadKbs() {
  const res = await kbApi.listAll()
  kbs.value = res
  if (res.length > 0) {
    selectedKbId.value = res[0].id
    onKbChanged()
  }
}

onMounted(loadKbs)

function onKbChanged() {
  searched.value = false
  results.value = []
  activeChunk.value = null
  const currentKb = kbs.value.find((k) => k.id === selectedKbId.value)
  if (currentKb) {
    threshold.value = currentKb.retrievalConfig.threshold
    stage1TopK.value = currentKb.retrievalConfig.stage1TopK
    finalTopK.value = currentKb.retrievalConfig.finalTopK
    rerank.value = currentKb.retrievalConfig.rerank
  }
}

async function runSearch() {
  const q = query.value.trim()
  if (!q || !selectedKbId.value) return
  activeChunk.value = null
  results.value = []
  
  const searchResult = await kbApi.searchInKb(selectedKbId.value, q, {
    threshold: threshold.value,
    rerank: rerank.value,
    stage1TopK: stage1TopK.value,
    finalTopK: finalTopK.value,
  })

  searched.value = true
  if (searchResult) {
    // 渲染最终重排或最终截断段落
    results.value = searchResult.stage2 ?? searchResult.stage1 ?? []
    if (results.value.length > 0) {
      activeChunk.value = results.value[0]
    }
  }
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
  if (!chunk || !selectedKbId.value) return
  const docId = chunk.documentId || chunk.document_id
  if (!docId) return
  
  loadingContext.value = true
  try {
    const res = await kbApi.getChunkContext(
      selectedKbId.value,
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

// 基于该片段发起问答
function startChatWithChunk(chunk: KnowledgeSearchChunk) {
  // 保存检索测试环境与当前 Chunk 快照到 localStorage，Chat 载入时自动恢复
  const payload = {
    query: query.value,
    kbId: selectedKbId.value,
    chunkId: chunk.id,
    content: chunk.content,
    source: chunk.source,
  }
  localStorage.setItem('__draft_rag_search', JSON.stringify(payload))
  
  router.push({
    path: '/chat',
    query: {
      knowledgeBaseId: selectedKbId.value,
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
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg, 12px);
  box-shadow: 
    0 4px 20px rgba(15, 23, 42, 0.02),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
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
  pointer-events: none;
}

.search-box input {
  width: 100%;
  height: 44px;
  padding: 0 16px 0 42px;
  border: 1px solid var(--border);
  border-radius: 10px;
  font: inherit;
  font-size: 14.5px;
  color: var(--text);
  outline: none;
  background: #fff;
  transition: all 0.2s ease;
}

.search-box input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.08);
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 24px;
  background: var(--primary-gradient, linear-gradient(135deg, #3b82f6, #2563eb));
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--shadow-btn);
  transition: all 0.2s ease;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.04);
  transform: translateY(-1px);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.search-filters {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
}

.filter-select {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.filter-select span {
  font-weight: 700;
}

.filter-select select {
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  background: #fff;
  color: var(--text);
  outline: none;
  min-width: 200px;
}

.btn-toggle {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  height: 38px;
  padding: 0 14px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.btn-toggle:hover {
  background: var(--page-bg-accent);
}

.rotate-icon {
  transform: rotate(180deg);
}

/* 高级面板 Slide Transition */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease;
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.advanced-panel {
  padding-top: 14px;
  border-top: 1px solid var(--border-muted, #f1f5f9);
}

.param-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px;
}

.param-slider,
.param-number {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.param-slider input {
  accent-color: var(--primary);
  width: 140px;
}

.param-number input {
  width: 72px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
}

.toggle-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 600;
  cursor: pointer;
  margin-top: 16px;
}

.toggle-checkbox input {
  accent-color: var(--primary);
}

/* 结果列表与展示 */
.results-panel {
  flex: 1;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg, 12px);
  box-shadow: 
    0 4px 20px rgba(15, 23, 42, 0.02),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 380px;
}

.state-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 32px;
  color: var(--text-muted);
  text-align: center;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(59, 130, 246, 0.1);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 12px;
}

.state-icon-decor {
  color: var(--text-muted);
  margin-bottom: 12px;
}

.state-container p {
  font-size: 13.5px;
  margin: 0;
}

.results-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  height: 100%;
  flex: 1;
  overflow: hidden;
}

.results-list {
  border-right: 1px solid var(--border-muted, #f1f5f9);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.results-list__head {
  padding: 14px 16px;
  background: #f8fafc;
  border-bottom: 1px solid var(--border-muted, #f1f5f9);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
}

.badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
}

.badge--success { background: #ecfdf5; color: #059669; }

.hit-feed {
  list-style: none;
  margin: 0;
  padding: 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.hit-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.hit-card:hover {
  background: var(--page-bg-accent, #f8fafc);
}

.hit-card--active {
  background: var(--primary-bg) !important;
  border-color: rgba(59, 130, 246, 0.2) !important;
}

.hit-idx {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: #f1f5f9;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
}

.hit-card--active .hit-idx {
  background: var(--primary);
  color: #fff;
}

.hit-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.hit-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hit-subtitle {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 2px;
}

.chunk-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  background: #ffffff;
}

.detail-card {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.detail-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border-muted, #f1f5f9);
}

.detail-card__head .label {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.detail-card__head h4 {
  margin: 4px 0 0;
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

.detail-meta {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: var(--text-muted);
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-action {
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-secondary);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.btn-action:hover {
  background: var(--page-bg-accent);
}

.btn-primary-sm {
  height: 34px;
  padding: 0 14px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.btn-primary-sm:hover {
  filter: brightness(1.04);
}

.detail-card__body {
  flex: 1;
}

.chunk-text {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--text-secondary);
  white-space: pre-wrap;
  font-family: inherit;
}

.detail-card-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}

/* Context Drawer 样式 */
.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 110;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.drawer {
  width: 100%;
  max-width: 520px;
  height: 100%;
  background: #ffffff;
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  animation: slide-in 0.2s ease-out;
}

.drawer-head {
  padding: 18px 20px;
  border-bottom: 1px solid var(--border-muted);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.drawer-title-stack {
  min-width: 0;
}

.drawer-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 750;
}

.drawer-subtitle {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-close {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.drawer-close:hover {
  background: var(--page-bg-accent);
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.drawer-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 240px;
  color: var(--text-muted);
}

.context-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.context-params {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  background: var(--page-bg-accent);
  padding: 10px 12px;
  border-radius: 8px;
}

.ctx-p {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.ctx-p input {
  width: 50px;
  height: 26px;
  border: 1px solid var(--border);
  border-radius: 4px;
  text-align: center;
  font: inherit;
  font-size: 11.5px;
}

.context-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.context-card {
  border: 1px solid var(--border-muted, #f1f5f9);
  border-radius: 8px;
  padding: 12px;
  background: #ffffff;
  transition: all 0.2s ease;
}

.context-card--active {
  border-color: rgba(59, 130, 246, 0.4);
  background: var(--primary-bg);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.04);
}

.context-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.c-idx {
  color: var(--primary);
}

.c-tag {
  background: var(--primary);
  color: #fff;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 8.5px;
}

.c-body {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--text-secondary);
  white-space: pre-wrap;
  font-family: inherit;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes slide-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

@media (max-width: 768px) {
  .results-layout {
    grid-template-columns: 1fr;
  }
  .results-list {
    border-right: none;
    border-bottom: 1px solid var(--border-muted);
    max-height: 240px;
  }
}
</style>
