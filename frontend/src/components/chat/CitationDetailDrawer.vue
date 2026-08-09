<template>
  <div class="drawer-backdrop" @click.self="$emit('close')">
    <aside class="drawer">
      <header class="drawer-head">
        <div class="drawer-title-stack">
          <h3>引用文献详情</h3>
          <p class="drawer-subtitle" :title="resolveSource">{{ resolveSource }}</p>
        </div>
        <button class="drawer-close" type="button" aria-label="关闭" @click="$emit('close')">
          <XIcon :size="16" />
        </button>
      </header>

      <div class="drawer-body">
        <!-- 核心指标卡 -->
        <section class="metrics-section" aria-label="检索指标">
          <dl class="metrics-list">
            <div class="metric-item">
              <dt>段落序号</dt>
              <dd>第 {{ chunkNumber }} 段</dd>
            </div>
            <div v-if="scoreText" class="metric-item">
              <dt>相似度得分</dt>
              <dd>{{ scoreText }}</dd>
            </div>
            <div v-if="retrievalSourceText" class="metric-item">
              <dt>检索召回路径</dt>
              <dd>{{ retrievalSourceText }}</dd>
            </div>
          </dl>
        </section>

        <!-- 上下文参数扩展区 -->
        <section class="context-panel" aria-label="上下文扩展">
          <header class="context-panel__head">
            <h5>上下文语境扩展</h5>
            <p>动态拉取当前分段的前后相邻片段，以还原更完整的业务背景。</p>
          </header>
          <div class="context-sliders">
            <label class="slider-field">
              <span>向前装载：<strong>{{ before }} 段</strong></span>
              <input v-model.number="before" type="range" min="0" max="5" step="1" @change="fetchExpandedContext" />
            </label>
            <label class="slider-field">
              <span>向后装载：<strong>{{ after }} 段</strong></span>
              <input v-model.number="after" type="range" min="0" max="5" step="1" @change="fetchExpandedContext" />
            </label>
          </div>
        </section>

        <!-- 内容渲染流 -->
        <section class="text-flow" aria-label="文本内容">
          <div v-if="loading" class="flow-loading">
            <div class="spinner"></div>
            <p>正在读取原文档相邻语境片段…</p>
          </div>

          <div v-else-if="contextItems.length" class="flow-container">
            <div
              v-for="item in contextItems"
              :key="item.id"
              class="chunk-block"
              :class="{ 'chunk-block--active': item.id === citation.id }"
            >
              <header class="chunk-block__head">
                <span class="block-idx">§ {{ item.chunkIndex + 1 }}</span>
                <span v-if="item.id === citation.id" class="block-tag">召回源片段</span>
                <span v-else class="block-tag-ctx">环境上下文</span>
              </header>
              <pre class="block-body">{{ item.content }}</pre>
            </div>
          </div>

          <div v-else class="flow-container">
            <!-- 回退方案：无上下文API或失败时展示原本的 citation.content -->
            <div class="chunk-block chunk-block--active">
              <header class="chunk-block__head">
                <span class="block-idx">§ {{ chunkNumber }}</span>
                <span class="block-tag">召回源片段</span>
              </header>
              <pre class="block-body">{{ citation.content || '暂无内容' }}</pre>
            </div>
            <p v-if="fetchError" class="context-error">{{ fetchError }}</p>
          </div>
        </section>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { XIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import type { Citation, KnowledgeChunk } from '@/types'

const props = defineProps<{
  citation: Citation
}>()

defineEmits<{
  (e: 'close'): void
}>()

const kbApi = useKnowledgeBase()
const before = ref(1)
const after = ref(1)
const loading = ref(false)
const fetchError = ref('')
const contextItems = ref<KnowledgeChunk[]>([])

const resolveSource = computed(() => props.citation.source ?? '未知文档')

const chunkNumber = computed(() => {
  const idx = props.citation.chunk_index ?? props.citation.chunkIndex ?? 0
  return idx + 1
})

function fmt(n: unknown): string {
  const v = Number(n)
  return Number.isFinite(v) ? v.toFixed(3) : ''
}

const scoreText = computed(() => {
  const parts = [
    props.citation.similarity != null ? `相似 ${fmt(props.citation.similarity)}` : '',
    props.citation.rerank_score != null ? `重排 ${fmt(props.citation.rerank_score)}` : '',
    props.citation.keyword_score != null ? `检索 ${fmt(props.citation.keyword_score)}` : '',
    props.citation.graph_score != null ? `图谱 ${fmt(props.citation.graph_score)}` : '',
  ].filter(Boolean)
  return parts.join(' · ')
})

const retrievalSourceText = computed(() => {
  if (Array.isArray(props.citation.retrieval_sources)) {
    return props.citation.retrieval_sources.join(' / ')
  }
  return ''
})

function resolveKbId(): string {
  return String(props.citation.knowledgeBaseId ?? props.citation.knowledge_base_id ?? '')
}

function resolveDocId(): string {
  return String(props.citation.documentId ?? props.citation.document_id ?? '')
}

async function fetchExpandedContext() {
  const kbId = resolveKbId()
  const docId = resolveDocId()
  const chunkId = props.citation.id
  if (!kbId || !docId || !chunkId) {
    contextItems.value = []
    return
  }

  loading.value = true
  fetchError.value = ''
  try {
    const res = await kbApi.getChunkContext(kbId, docId, chunkId, before.value, after.value)
    if (res) {
      contextItems.value = res.items
    } else {
      fetchError.value = '未能获取语境前后分段环境。'
    }
  } catch {
    fetchError.value = '请求异常，暂时无法加载扩展上下文。'
  } finally {
    loading.value = false
  }
}

onMounted(fetchExpandedContext)
watch(() => props.citation.id, () => {
  before.value = 1
  after.value = 1
  fetchExpandedContext()
})
</script>

<style scoped>
.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.drawer {
  width: 100%;
  max-width: 520px;
  height: 100%;
  background: #ffffff;
  box-shadow: -10px 0 40px rgba(15, 23, 42, 0.12);
  display: flex;
  flex-direction: column;
  animation: slide-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slide-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.drawer-head {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-muted, #f1f5f9);
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
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.01em;
}

.drawer-subtitle {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-close {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: #fff;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.drawer-close:hover {
  background: var(--page-bg-accent, #f8fafc);
  color: var(--text);
  border-color: rgba(226, 232, 240, 1);
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.metrics-section {
  padding: 14px 18px;
  background: var(--page-bg-accent, #f8fafc);
  border-radius: 10px;
  border: 1px solid rgba(226, 232, 240, 0.6);
}

.metrics-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.metric-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}

.metric-item dt {
  color: var(--text-muted);
  font-weight: 600;
}

.metric-item dd {
  margin: 0;
  color: var(--text-secondary);
  font-weight: 700;
}

.context-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: #ffffff;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.01);
}

.context-panel__head h5 {
  margin: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text);
}

.context-panel__head p {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.context-sliders {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding-top: 4px;
}

.slider-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
}

.slider-field span {
  font-weight: 600;
}

.slider-field input {
  accent-color: var(--primary);
  width: 100%;
}

.text-flow {
  flex: 1;
}

.flow-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
  color: var(--text-muted);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(59, 130, 246, 0.1);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 10px;
}

.flow-loading p {
  margin: 0;
  font-size: 12px;
}

.flow-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.chunk-block {
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 10px;
  padding: 14px;
  background: #fafafb;
  transition: all 0.2s ease;
}

.chunk-block--active {
  border-color: rgba(59, 130, 246, 0.4);
  background: var(--primary-bg, #eff6ff);
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.04);
}

.chunk-block__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 10px;
  font-weight: 700;
}

.block-idx {
  color: var(--primary);
}

.block-tag {
  background: var(--primary);
  color: #fff;
  padding: 1px 6px;
  border-radius: 4px;
}

.block-tag-ctx {
  background: #e2e8f0;
  color: #475569;
  padding: 1px 6px;
  border-radius: 4px;
}

.block-body {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
  white-space: pre-wrap;
  font-family: inherit;
}

.context-error {
  font-size: 11.5px;
  color: #dc2626;
  background: #fef2f2;
  padding: 6px 12px;
  border-radius: 6px;
  margin: 10px 0 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
