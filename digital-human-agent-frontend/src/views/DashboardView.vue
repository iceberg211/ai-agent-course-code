<template>
  <main class="dashboard">
    <header class="dashboard__head">
      <div>
        <h2>首页大盘</h2>
        <p class="subtitle">监控企业知识底座与智能问答的运行状况</p>
      </div>
      <button class="btn-primary" type="button" @click="router.push('/chat')">
        <MessageSquareIcon :size="15" />
        发起问答
      </button>
    </header>

    <div v-if="loading && !summary" class="loading-state">
      <div class="spinner"></div>
      <p>正在加载系统指标…</p>
    </div>

    <div v-else-if="!summary" class="error-state">
      <AlertCircleIcon :size="32" class="error-icon" />
      <p>大盘数据获取失败，请稍后重试。</p>
      <button class="btn-ghost" type="button" @click="loadData">重新加载</button>
    </div>

    <div v-else class="dashboard__body">
      <!-- 统计指标格 -->
      <section class="stat-grid" aria-label="数据概览">
        <div class="stat-card">
          <div class="stat-card__icon bg-blue">
            <LibraryIcon :size="18" />
          </div>
          <div class="stat-card__data">
            <span class="label">知识库</span>
            <strong class="number">{{ summary.knowledgeBaseCount }}</strong>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon bg-purple">
            <FileTextIcon :size="18" />
          </div>
          <div class="stat-card__data">
            <span class="label">文档总数</span>
            <strong class="number">{{ summary.documentCount }}</strong>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon bg-indigo">
            <SparklesIcon :size="18" />
          </div>
          <div class="stat-card__data">
            <span class="label">片段总数 (Chunks)</span>
            <strong class="number">{{ summary.chunkCount }}</strong>
          </div>
        </div>
        <div class="stat-card" :class="{ 'warning-border': summary.failedDocumentCount > 0 }">
          <div class="stat-card__icon" :class="summary.failedDocumentCount > 0 ? 'bg-red' : 'bg-green'">
            <AlertCircleIcon :size="18" />
          </div>
          <div class="stat-card__data">
            <span class="label">失败文档</span>
            <strong class="number" :class="{ 'text-red': summary.failedDocumentCount > 0 }">
              {{ summary.failedDocumentCount }}
            </strong>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon bg-teal">
            <MessageSquareIcon :size="18" />
          </div>
          <div class="stat-card__data">
            <span class="label">总会话数</span>
            <strong class="number">{{ summary.conversationCount }}</strong>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon bg-orange">
            <BarChart3Icon :size="18" />
          </div>
          <div class="stat-card__data">
            <span class="label">总消息数</span>
            <strong class="number">{{ summary.messageCount }}</strong>
          </div>
        </div>
      </section>

      <!-- 阶段 7 / 8 核心交付：核心运行与安全指标大盘 -->
      <section class="performance-metrics-grid" aria-label="核心运行指标">
        <div class="metric-card">
          <span class="metric-card__title">平均问答时延</span>
          <strong class="metric-card__val">{{ summary.averageLatencyMs ? summary.averageLatencyMs + ' ms' : '暂无数据' }}</strong>
          <small class="metric-card__desc">系统接收问题至回答生成耗时</small>
        </div>
        <div class="metric-card">
          <span class="metric-card__title">平均文档处理耗时</span>
          <strong class="metric-card__val">{{ formatProcessTime(summary.averageDocumentProcessTimeMs) }}</strong>
          <small class="metric-card__desc">基于最近50篇成功分片解析的文档</small>
        </div>
        <div class="metric-card">
          <span class="metric-card__title">多模态文档占比</span>
          <strong class="metric-card__val">{{ percent(summary.multimodalRate) }}</strong>
          <small class="metric-card__desc">图片/音频/视频格式在库数量占比</small>
        </div>
        <div class="metric-card" :class="{ 'alert-card': (summary.blockedAccessCount || 0) > 0 }">
          <span class="metric-card__title">越权拦截次数</span>
          <strong class="metric-card__val" :class="{ 'text-red': (summary.blockedAccessCount || 0) > 0 }">
            {{ summary.blockedAccessCount ?? 0 }} 次
          </strong>
          <small class="metric-card__desc">越权异常请求阻断累计计数</small>
        </div>
        <div class="metric-card">
          <span class="metric-card__title">安全隐式过滤片段</span>
          <strong class="metric-card__val">{{ summary.totalPermissionFilteredCount ?? 0 }} 段</strong>
          <small class="metric-card__desc">因ACL权限拦截而自动隐藏的召回条数</small>
        </div>
      </section>

      <section class="health-grid" aria-label="知识库健康">
        <button type="button" class="health-card" @click="goDocuments({ status: 'failed' })">
          <span>失败文档趋势</span>
          <strong>{{ summary.failedDocumentTrend?.at(-1)?.count ?? summary.failedDocumentCount }}</strong>
          <small>最近失败：{{ summary.recentFailedDocuments?.length ?? 0 }} 个</small>
        </button>
        <button type="button" class="health-card" @click="goDocuments({ processingStage: 'completed' })">
          <span>无片段文档</span>
          <strong>{{ summary.unchunkedDocumentCount ?? 0 }}</strong>
          <small>需要重新解析或检查文件内容</small>
        </button>
        <button type="button" class="health-card" @click="goDocuments({ graphStatus: 'failed' })">
          <span>图谱同步失败</span>
          <strong>{{ summary.graphFailedDocumentCount ?? 0 }}</strong>
          <small>影响关系检索与图谱探索</small>
        </button>
        <button type="button" class="health-card" @click="router.push('/kb')">
          <span>验证通过率</span>
          <strong>{{ percent(summary.evalPassRate) }}</strong>
          <small>来自问答验证用例</small>
        </button>
        <button type="button" class="health-card" @click="router.push('/chat')">
          <span>无引用回答率</span>
          <strong>{{ percent(summary.noCitationRate) }}</strong>
          <small>需要关注可信回答质量</small>
        </button>
      </section>

      <!-- 双栏近态追踪 -->
      <div class="dynamic-layout">
        <!-- 最近文档 -->
        <article class="feed-card">
          <header class="feed-card__head">
            <h3>最近上传文档</h3>
            <button class="text-link" type="button" @click="router.push('/documents')">查看全部</button>
          </header>
          <ul v-if="summary.recentDocuments.length" class="doc-feed">
            <li v-for="doc in summary.recentDocuments" :key="doc.id" class="doc-feed-item">
              <div class="doc-feed-item__info">
                <FileTextIcon :size="15" class="doc-icon" />
                <span class="doc-name" :title="doc.filename">{{ doc.filename }}</span>
              </div>
              <div class="doc-feed-item__status">
                <span class="badge" :class="badgeClassOf(doc)">
                  {{ statusLabelOf(doc) }}
                </span>
                <span class="time">{{ formatDate(doc.createdAt || doc.created_at) }}</span>
              </div>
            </li>
          </ul>
          <p v-else class="empty-feed">暂无最近上传文档</p>
        </article>

        <!-- 最近问答 -->
        <article class="feed-card">
          <header class="feed-card__head">
            <h3>最近对话历史</h3>
            <button class="text-link" type="button" @click="router.push('/chat')">查看全部</button>
          </header>
          <ul v-if="summary.recentConversations.length" class="chat-feed">
            <li v-for="conv in summary.recentConversations" :key="conv.id" class="chat-feed-item" @click="goChat(conv.id)">
              <div class="chat-feed-item__meta">
                <span class="icon-avatar">💬</span>
                <div class="chat-details">
                  <strong class="chat-question" :title="conv.lastMessage?.content || '新对话'">
                    {{ conv.lastMessage?.content || '新对话' }}
                  </strong>
                  <span class="chat-time">{{ formatDate(conv.updatedAt) }}</span>
                </div>
              </div>
              <ChevronRightIcon :size="14" class="arrow-icon" />
            </li>
          </ul>
          <p v-else class="empty-feed">暂无最近会话历史</p>
        </article>
      </div>

      <div class="dynamic-layout">
        <article class="feed-card">
          <header class="feed-card__head">
            <h3>最近失败文档</h3>
            <button class="text-link" type="button" @click="goDocuments({ status: 'failed' })">查看失败</button>
          </header>
          <ul v-if="summary.recentFailedDocuments?.length" class="doc-feed">
            <li v-for="doc in summary.recentFailedDocuments" :key="doc.id" class="doc-feed-item">
              <div class="doc-feed-item__info">
                <AlertCircleIcon :size="15" class="doc-icon" />
                <span class="doc-name" :title="doc.filename">{{ doc.filename }}</span>
              </div>
              <span class="time">{{ doc.processingError ?? doc.processing_error ?? '处理失败' }}</span>
            </li>
          </ul>
          <p v-else class="empty-feed">暂无失败文档</p>
        </article>

        <article class="feed-card">
          <header class="feed-card__head">
            <h3>热门问题与低评分回答</h3>
            <button class="text-link" type="button" @click="router.push('/chat')">进入问答</button>
          </header>
          <ul v-if="summary.hotQuestions?.length" class="chat-feed">
            <li v-for="item in summary.hotQuestions" :key="item.question" class="chat-feed-item">
              <div class="chat-details">
                <strong class="chat-question">{{ item.question }}</strong>
                <span class="chat-time">出现 {{ item.count }} 次</span>
              </div>
            </li>
          </ul>
          <p v-else class="empty-feed">暂无热门问题统计</p>
        </article>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircleIcon,
  BarChart3Icon,
  ChevronRightIcon,
  FileTextIcon,
  LibraryIcon,
  MessageSquareIcon,
  SparklesIcon,
} from 'lucide-vue-next'
import { useProductizedKnowledge } from '@/hooks/useProductizedKnowledge'
import { KNOWLEDGE_DOCUMENT_STATUS_LABELS } from '@/common/constants'
import type { DashboardSummary, KnowledgeDocument } from '@/types'

const router = useRouter()
const { getDashboardSummary } = useProductizedKnowledge()

const summary = ref<DashboardSummary | null>(null)
const loading = ref(false)

async function loadData() {
  loading.value = true
  try {
    const result = await getDashboardSummary()
    if (result) {
      summary.value = result
    }
  } finally {
    loading.value = false
  }
}

onMounted(loadData)

function statusLabelOf(doc: KnowledgeDocument): string {
  const status = doc.status || 'pending'
  return KNOWLEDGE_DOCUMENT_STATUS_LABELS[status] ?? status
}

function badgeClassOf(doc: KnowledgeDocument): string {
  const status = doc.status || 'pending'
  if (status === 'completed') return 'badge--success'
  if (status === 'failed') return 'badge--error'
  if (status === 'processing') return 'badge--warning'
  return 'badge--secondary'
}

function goChat(conversationId: string) {
  router.push({
    path: '/chat',
    query: { conversationId },
  })
}

function goDocuments(query: Record<string, string>) {
  router.push({ path: '/documents', query })
}

function percent(value?: number) {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0%'
  return `${Math.round(n * 100)}%`
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin}分钟前`
  
  const diffHrs = Math.floor(diffMin / 60)
  if (diffHrs < 24) return `${diffHrs}小时前`

  return `${date.getMonth() + 1}/${date.getDate()}`
}

function formatProcessTime(ms?: number): string {
  if (!ms) return '暂无数据'
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes} 分 ${remainingSeconds} 秒`
}
</script>

<style scoped>
.performance-metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 8px;
}
.metric-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.01);
  transition: all 0.2s ease;
  text-align: left;
}
.metric-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(99,102,241,0.04);
  border-color: rgba(99,102,241,0.15);
}
.metric-card__title {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 600;
}
.metric-card__val {
  font-size: 20px;
  font-weight: 800;
  color: var(--text);
}
.metric-card__desc {
  font-size: 11px;
  color: var(--text-muted);
}
.alert-card {
  border-color: rgba(239, 68, 68, 0.2);
  background: #fffbfa;
}
.alert-card:hover {
  border-color: rgba(239, 68, 68, 0.4);
}
.text-red {
  color: #ef4444 !important;
}

.dashboard {
  padding: 32px 24px;
  height: 100%;
  overflow-y: auto;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.dashboard__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.dashboard__head h2 {
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

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--primary-gradient, linear-gradient(135deg, #3b82f6, #2563eb));
  color: #fff;
  border: none;
  border-radius: var(--radius-md, 8px);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--shadow-btn);
  transition: all 0.2s ease;
}

.btn-primary:hover {
  filter: brightness(1.04);
  transform: translateY(-1px);
  box-shadow: var(--shadow-btn-hover);
}

.loading-state,
.error-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 32px;
  background: rgba(255, 255, 255, 0.55);
  border-radius: var(--radius-lg, 12px);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(226, 232, 240, 0.6);
  min-height: 320px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(59, 130, 246, 0.15);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 12px;
}

.error-icon {
  color: var(--error, #dc2626);
  margin-bottom: 12px;
}

.error-state p,
.loading-state p {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0 0 16px;
}

.btn-ghost {
  padding: 6px 14px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.btn-ghost:hover {
  background: rgba(59, 130, 246, 0.05);
  color: var(--primary);
}

.dashboard__body {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.health-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
}

.health-card {
  display: flex;
  min-height: 112px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 16px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.health-card:hover {
  border-color: rgba(59, 130, 246, 0.35);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
}

.health-card span {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.health-card strong {
  font-size: 24px;
  line-height: 1;
}

.health-card small {
  color: var(--text-muted);
  line-height: 1.45;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg, 12px);
  box-shadow: 
    0 4px 20px rgba(15, 23, 42, 0.02),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  transition: transform 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out), border-color 0.25s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  border-color: rgba(59, 130, 246, 0.3);
  box-shadow: 
    0 12px 24px rgba(15, 23, 42, 0.04),
    0 4px 8px rgba(15, 23, 42, 0.02);
}

.stat-card__icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bg-blue { background: rgba(59, 130, 246, 0.08); color: #2563eb; }
.bg-purple { background: rgba(168, 85, 247, 0.08); color: #9333ea; }
.bg-indigo { background: rgba(99, 102, 241, 0.08); color: #4f46e5; }
.bg-red { background: rgba(239, 68, 68, 0.08); color: #dc2626; }
.bg-green { background: rgba(16, 185, 129, 0.08); color: #059669; }
.bg-teal { background: rgba(20, 184, 166, 0.08); color: #0d9488; }
.bg-orange { background: rgba(249, 115, 22, 0.08); color: #ea580c; }

.warning-border {
  border-color: rgba(239, 68, 68, 0.4);
}

.text-red {
  color: #dc2626;
}

.stat-card__data {
  display: flex;
  flex-direction: column;
}

.stat-card__data .label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.stat-card__data .number {
  font-size: 22px;
  font-weight: 800;
  color: var(--text);
  margin-top: 2px;
  line-height: 1;
}

.dynamic-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.feed-card {
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg, 12px);
  padding: 20px;
  box-shadow: 
    0 4px 20px rgba(15, 23, 42, 0.02),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  display: flex;
  flex-direction: column;
  min-height: 280px;
  transition: transform 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out);
}

.feed-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-muted, #f1f5f9);
}

.feed-card__head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.text-link {
  background: none;
  border: none;
  color: var(--primary);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
}

.text-link:hover {
  text-decoration: underline;
}

.doc-feed,
.chat-feed {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.doc-feed-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--page-bg-accent, #f8fafc);
  border-radius: 8px;
  border: 1px solid rgba(226, 232, 240, 0.4);
}

.doc-feed-item__info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.doc-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.doc-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-feed-item__status {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.badge {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
}

.badge--success { background: #ecfdf5; color: #059669; }
.badge--warning { background: #fffbeb; color: #d97706; }
.badge--error { background: #fef2f2; color: #dc2626; }
.badge--secondary { background: #f1f5f9; color: #475569; }

.time,
.chat-time {
  font-size: 10px;
  color: var(--text-muted);
}

.chat-feed-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid rgba(226, 232, 240, 0.7);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.chat-feed-item:hover {
  background: var(--page-bg-accent, #f8fafc);
  border-color: rgba(59, 130, 246, 0.25);
  transform: translateX(1px);
}

.chat-feed-item__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.icon-avatar {
  font-size: 16px;
}

.chat-details {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-question {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-time {
  margin-top: 2px;
}

.arrow-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.empty-feed {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12.5px;
  border: 1px dashed rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  margin: 0;
  min-height: 120px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 880px) {
  .dynamic-layout {
    grid-template-columns: 1fr;
  }
}
</style>
