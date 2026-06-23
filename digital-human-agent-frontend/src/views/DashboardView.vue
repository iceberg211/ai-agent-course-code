<template>
  <main class="page">
    <header class="page-head">
      <div>
        <p class="eyebrow">首页大盘</p>
        <h1>企业知识资产概览</h1>
      </div>
      <button class="ghost-btn" type="button" @click="load">
        <RefreshCwIcon :size="15" />
        刷新
      </button>
    </header>

    <section class="metrics" aria-label="核心指标">
      <article v-for="item in metricItems" :key="item.label" class="metric">
        <component :is="item.icon" :size="20" aria-hidden="true" />
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </article>
    </section>

    <section class="grid">
      <article class="panel">
        <header class="panel-head">
          <h2>最近上传</h2>
          <RouterLink to="/documents">查看文档</RouterLink>
        </header>
        <ul v-if="summary?.recentDocuments?.length" class="list">
          <li v-for="doc in summary.recentDocuments" :key="doc.id">
            <FileTextIcon :size="16" />
            <div>
              <strong>{{ doc.filename }}</strong>
              <span>{{ resolveKnowledgeName(doc) }} · {{ statusLabel(doc.status) }}</span>
            </div>
          </li>
        </ul>
        <p v-else class="empty">暂无上传记录</p>
      </article>

      <article class="panel">
        <header class="panel-head">
          <h2>最近会话</h2>
          <RouterLink to="/chat">进入问答</RouterLink>
        </header>
        <ul v-if="summary?.recentConversations?.length" class="list">
          <li v-for="conversation in summary.recentConversations" :key="conversation.id">
            <MessageSquareIcon :size="16" />
            <div>
              <strong>{{ conversation.lastMessage?.content || '新会话' }}</strong>
              <span>{{ formatDate(conversation.updatedAt) }}</span>
            </div>
          </li>
        </ul>
        <p v-else class="empty">暂无会话记录</p>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  BoxesIcon,
  FileTextIcon,
  LibraryIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from 'lucide-vue-next'
import { useProductizedKnowledge } from '@/hooks/useProductizedKnowledge'
import type { DashboardSummary, KnowledgeDocument } from '@/types'

const api = useProductizedKnowledge()
const summary = ref<DashboardSummary | null>(null)

const metricItems = computed(() => [
  { label: '知识库', value: summary.value?.knowledgeBaseCount ?? 0, icon: LibraryIcon },
  { label: '文档', value: summary.value?.documentCount ?? 0, icon: FileTextIcon },
  { label: '知识片段', value: summary.value?.chunkCount ?? 0, icon: BoxesIcon },
  { label: '失败文档', value: summary.value?.failedDocumentCount ?? 0, icon: ShieldAlertIcon },
  { label: '问答次数', value: summary.value?.messageCount ?? 0, icon: MessageSquareIcon },
])

onMounted(load)

async function load() {
  summary.value = await api.getDashboardSummary()
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pending: '排队中',
    processing: '处理中',
    completed: '就绪',
    failed: '失败',
  }
  return map[status] ?? status
}

function resolveKnowledgeName(doc: KnowledgeDocument) {
  return doc.knowledge?.name ?? '未归属知识库'
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}
</script>

<style scoped>
.page {
  height: 100%;
  overflow: auto;
  padding: 28px 24px;
  background: var(--page-bg-accent);
}
.page-head,
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.eyebrow {
  margin: 0;
  font-size: 11px;
  font-weight: 800;
  color: var(--primary);
}
h1 {
  margin: 2px 0 0;
  font-size: 24px;
}
.ghost-btn,
.panel-head a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 13px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--primary);
  font-weight: 700;
  text-decoration: none;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
  margin: 22px 0;
}
.metric,
.panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.metric {
  display: grid;
  gap: 8px;
  padding: 18px;
}
.metric svg {
  color: var(--primary);
}
.metric span {
  color: var(--text-muted);
}
.metric strong {
  font-size: 28px;
  line-height: 1;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.panel {
  padding: 18px;
}
.panel h2 {
  margin: 0;
  font-size: 16px;
}
.list {
  list-style: none;
  display: grid;
  gap: 10px;
  margin-top: 14px;
}
.list li {
  display: flex;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border-muted);
  border-radius: 8px;
}
.list svg {
  color: var(--primary);
  flex-shrink: 0;
  margin-top: 2px;
}
.list div {
  min-width: 0;
}
.list strong,
.list span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.list span,
.empty {
  color: var(--text-muted);
  font-size: 12px;
}
.empty {
  margin-top: 18px;
}
@media (max-width: 980px) {
  .metrics,
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
