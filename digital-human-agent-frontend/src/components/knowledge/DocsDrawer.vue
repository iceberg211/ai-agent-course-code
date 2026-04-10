<template>
  <aside class="docs-drawer" aria-label="知识库管理">
    <div class="drawer-header">
      <div class="title">
        <BookOpenIcon :size="15" color="var(--primary)" aria-hidden="true" />
        <span>知识库</span>
      </div>
      <button class="close-btn" @click="$emit('close')" aria-label="关闭知识库面板">
        <XIcon :size="15" aria-hidden="true" />
      </button>
    </div>

    <UploadZone :uploading="uploading" @upload="handleUpload" />

    <section class="search-panel" aria-label="检索测试">
      <div class="search-title">检索测试</div>
      <div class="search-row">
        <input
          v-model="searchQuery"
          class="search-input"
          type="text"
          :disabled="searching || !personaId"
          placeholder="输入问题，查看 stage1 / stage2"
          @keydown.enter="handleSearch"
        />
        <button
          class="search-btn"
          :disabled="searching || !personaId || !searchQuery.trim()"
          @click="handleSearch"
        >
          {{ searching ? '检索中' : '检索' }}
        </button>
      </div>
      <p class="search-tip">用于观察向量召回与重排差异</p>

      <div v-if="searchResult" class="search-result">
        <div class="result-head">
          <span>stage1: {{ searchResult.stage1.length }}</span>
          <span>stage2: {{ searchResult.stage2.length }}</span>
        </div>
        <div class="result-columns">
          <section class="result-col">
            <h4>向量召回</h4>
            <ol>
              <li v-for="(item, idx) in searchResult.stage1" :key="`stage1-${item.id}-${idx}`">
                <div class="line-main">{{ idx + 1 }}. {{ item.source }} · §{{ item.chunk_index + 1 }}</div>
                <div class="line-sub">sim: {{ toFixed(item.similarity) }}</div>
              </li>
            </ol>
          </section>
          <section class="result-col">
            <h4>重排结果</h4>
            <ol>
              <li v-for="(item, idx) in searchResult.stage2" :key="`stage2-${item.id}-${idx}`">
                <div class="line-main">{{ idx + 1 }}. {{ item.source }} · §{{ item.chunk_index + 1 }}</div>
                <div class="line-sub">
                  rerank: {{ toFixed(item.rerank_score) }} · sim: {{ toFixed(item.similarity) }}
                </div>
              </li>
            </ol>
          </section>
        </div>
      </div>
    </section>

    <div class="list-header">
      <span>已上传文档</span>
      <span class="badge">{{ documents.length }}</span>
    </div>

    <ul class="doc-list" role="list" aria-label="文档列表">
      <template v-if="loading">
        <li v-for="i in 4" :key="`doc-skeleton-${i}`" class="doc-skeleton" aria-hidden="true">
          <span class="sk-icon" />
          <span class="sk-body">
            <span class="sk-line sk-main" />
            <span class="sk-line sk-sub" />
          </span>
        </li>
      </template>
      <template v-else>
        <DocItem
          v-for="doc in documents"
          :key="doc.id"
          :doc="doc"
          :status-label="statusLabel"
          @delete="handleDelete"
        />
      </template>
      <li v-if="!loading && !documents.length" class="doc-empty" role="status">
        上传文档后可供 AI 检索引用
      </li>
    </ul>
  </aside>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { BookOpenIcon, XIcon } from 'lucide-vue-next'
import UploadZone from './UploadZone.vue'
import DocItem from './DocItem.vue'
import type { KnowledgeDocument, KnowledgeSearchResult } from '../../types'

withDefaults(defineProps<{
  personaId: string
  documents: KnowledgeDocument[]
  uploading: boolean
  loading: boolean
  searching: boolean
  searchResult: KnowledgeSearchResult | null
  statusLabel: (status: string) => string
}>(), {
  personaId: '',
  documents: () => [],
  uploading: false,
  loading: false,
  searching: false,
  searchResult: null,
})
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'upload', file: File): void
  (e: 'delete', docId: string): void
  (e: 'search', query: string): void
}>()

const searchQuery = ref('')

function handleUpload(file: File) { emit('upload', file) }
function handleDelete(docId: string) { emit('delete', docId) }
function handleSearch() {
  const query = searchQuery.value.trim()
  if (!query) return
  emit('search', query)
}
function toFixed(value: number | undefined): string {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(3) : '-'
}
</script>

<style scoped>
.docs-drawer {
  width: 292px; flex-shrink: 0;
  background: linear-gradient(180deg, #ffffff, #f9fbff); border-left: 1px solid var(--border);
  display: flex; flex-direction: column; overflow: hidden;
}
.drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--border);
}
.title { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 600; color: var(--text); }
.close-btn {
  width: 28px; height: 28px; border-radius: 6px; border: none; background: none;
  color: var(--text-muted); display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background-color 150ms ease-out, color 150ms ease-out;
}
.close-btn:hover { background: var(--primary-bg); color: var(--text); }
.search-panel {
  margin: 8px 12px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: #f8fbff;
}
.search-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}
.search-row {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}
.search-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--text);
  background: #fff;
}
.search-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(95, 87, 255, 0.16);
}
.search-btn {
  border: 1px solid var(--primary);
  border-radius: 8px;
  background: var(--primary-bg);
  color: var(--primary);
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.search-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.search-tip {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-muted);
}
.search-result {
  margin-top: 8px;
  border-top: 1px dashed var(--border);
  padding-top: 8px;
}
.result-head {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 600;
}
.result-columns {
  margin-top: 6px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.result-col {
  min-width: 0;
}
.result-col h4 {
  margin: 0 0 4px;
  font-size: 11px;
  color: var(--text);
}
.result-col ol {
  margin: 0;
  padding-left: 16px;
}
.result-col li {
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--text-secondary);
}
.line-main {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.line-sub {
  color: var(--text-muted);
}
.list-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px 6px; font-size: 10px; font-weight: 700;
  color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em;
}
.badge { background: var(--primary-bg); color: var(--text-secondary); border-radius: 10px; padding: 1px 7px; font-size: 11px; }
.doc-list { flex: 1; overflow-y: auto; padding: 2px 8px 12px; list-style: none; }
.doc-empty { text-align: center; color: var(--text-muted); font-size: 12px; padding: 20px; list-style: none; }
.doc-skeleton {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  list-style: none;
}
.sk-icon {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: linear-gradient(90deg, #eef4ff 20%, #dbe8ff 45%, #eef4ff 75%);
  background-size: 240% 100%;
  animation: shimmer 1.3s linear infinite;
}
.sk-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.sk-line {
  display: block;
  height: 8px;
  border-radius: 6px;
  background: linear-gradient(90deg, #eef4ff 20%, #dbe8ff 45%, #eef4ff 75%);
  background-size: 240% 100%;
  animation: shimmer 1.3s linear infinite;
}
.sk-main { width: 72%; }
.sk-sub { width: 44%; }

@keyframes shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}

@media (max-width: 960px) {
  .docs-drawer {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: min(86vw, 300px);
    z-index: 20;
    box-shadow: -12px 0 24px rgba(26, 48, 79, 0.14);
  }
}
</style>
