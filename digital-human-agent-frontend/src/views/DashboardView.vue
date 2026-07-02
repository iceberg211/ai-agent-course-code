<template>
  <main class="dashboard">
    <!-- 头部：清爽的 Title 和快捷操作 -->
    <header class="dashboard__head">
      <div class="dashboard__head-title">
        <h2>控制台大盘</h2>
        <p class="subtitle">实时监控您的企业知识底座、问答效能与多模态安全审计指标</p>
      </div>
      <button class="btn-primary" type="button" @click="router.push('/chat')">
        <MessageSquareIcon :size="14" />
        <span>发起数字人通话</span>
      </button>
    </header>

    <!-- 新手指引：快捷操作路径 (3列，每列 col-4) -->
    <section class="grid-row" aria-label="快捷向导">
      <div class="quick-card col-4" @click="router.push('/documents')">
        <div class="quick-card__icon bg-step1">
          <PlusIcon :size="15" />
        </div>
        <div class="quick-card__info">
          <h4>① 录入企业知识</h4>
          <p>支持 PDF 及音视频，后台自动进行分片和解析入库任务。</p>
        </div>
        <span class="quick-card__link">立即导入 →</span>
      </div>

      <div class="quick-card col-4" @click="router.push('/search')">
        <div class="quick-card__icon bg-step2">
          <SearchIcon :size="15" />
        </div>
        <div class="quick-card__info">
          <h4>② 检索关联资产</h4>
          <p>实时调参，洞察多路 RRF 融合与重排 Trace 轨迹。</p>
        </div>
        <span class="quick-card__link">检索测试 →</span>
      </div>

      <div class="quick-card col-4" @click="router.push('/chat')">
        <div class="quick-card__icon bg-step3">
          <MessageSquareIcon :size="15" />
        </div>
        <div class="quick-card__info">
          <h4>③ 数字人对话</h4>
          <p>与您的专属 3D/2D 虚拟分身建立高拟真音视频通话。</p>
        </div>
        <span class="quick-card__link">建立连线 →</span>
      </div>
    </section>

    <!-- 2. 数据加载时的 Skeleton 骨架屏占位 -->
    <div v-if="loading && !summary" class="skeleton-wrapper" aria-label="正在加载系统指标">
      <div class="grid-row">
        <div v-for="i in 3" :key="i" class="col-4 skeleton-pulse" style="height: 110px; border-radius: 12px" />
      </div>
      <div class="grid-row">
        <div v-for="i in 4" :key="i" class="col-3 skeleton-pulse" style="height: 120px; border-radius: 12px" />
      </div>
      <div class="grid-row">
        <div class="col-6 skeleton-pulse" style="height: 280px; border-radius: 12px" />
        <div class="col-6 skeleton-pulse" style="height: 280px; border-radius: 12px" />
      </div>
    </div>

    <!-- 3. 数据拉取失败提示 -->
    <div v-else-if="!summary" class="error-state" role="alert">
      <AlertCircleIcon :size="32" class="error-icon" />
      <p>首页大盘数据加载失败，可能由于本地后端连接中断，请检查服务状态。</p>
      <button class="btn-ghost" type="button" @click="loadData">重新加载</button>
    </div>

    <!-- 4. 实体仪表盘内容 -->
    <div v-else class="dashboard__body">
      <!-- 4 个精心设计的大版块核心指标卡片 (4列，每列 col-3) -->
      <section class="grid-row" aria-label="核心指标看板">
        <!-- 卡片 1：知识库资产 -->
        <div class="stat-card-opt col-3">
          <div class="stat-card-opt__header">
            <span class="title">知识库资产</span>
            <LibraryIcon :size="15" class="icon-blue" />
          </div>
          <div class="stat-card-opt__body">
            <div class="metric">
              <strong class="number">{{ summary?.knowledgeBaseCount ?? 0 }}</strong>
              <span class="unit">个知识库</span>
            </div>
            <div class="sub-metrics">
              <span>文档：<strong>{{ summary?.documentCount ?? 0 }}</strong> 篇</span>
              <span class="separator">|</span>
              <span>分片：<strong>{{ summary?.chunkCount ?? 0 }}</strong> 段</span>
            </div>
          </div>
        </div>

        <!-- 卡片 2：会话与交互 -->
        <div class="stat-card-opt col-3">
          <div class="stat-card-opt__header">
            <span class="title">会话与交互</span>
            <MessageSquareIcon :size="15" class="icon-teal" />
          </div>
          <div class="stat-card-opt__body">
            <div class="metric">
              <strong class="number">{{ summary?.conversationCount ?? 0 }}</strong>
              <span class="unit">次会话</span>
            </div>
            <div class="sub-metrics">
              <span>消息总数：<strong>{{ summary?.messageCount ?? 0 }}</strong> 条</span>
            </div>
          </div>
        </div>

        <!-- 卡片 3：检索与系统时延 -->
        <div class="stat-card-opt col-3">
          <div class="stat-card-opt__header">
            <span class="title">平均问答时延</span>
            <SparklesIcon :size="15" class="icon-indigo" />
          </div>
          <div class="stat-card-opt__body">
            <div class="metric">
              <strong class="number">{{ formatLatency(summary?.averageLatencyMs) }}</strong>
              <span class="unit">秒</span>
            </div>
            <div class="sub-metrics">
              <span>文档处理耗时：<strong>{{ formatProcessTime(summary?.averageDocumentProcessTimeMs) }}</strong></span>
            </div>
          </div>
        </div>

        <!-- 卡片 4：安全隔离与健康 -->
        <div class="stat-card-opt col-3" :class="{ 'has-alert': (summary?.failedDocumentCount ?? 0) > 0 }">
          <div class="stat-card-opt__header">
            <span class="title">安全与故障审计</span>
            <AlertCircleIcon :size="15" :class="(summary?.failedDocumentCount ?? 0) > 0 ? 'icon-red' : 'icon-green'" />
          </div>
          <div class="stat-card-opt__body">
            <div class="metric">
              <strong class="number">{{ summary?.failedDocumentCount ?? 0 }}</strong>
              <span class="unit" :class="{ 'text-red': (summary?.failedDocumentCount ?? 0) > 0 }">篇解析失败</span>
            </div>
            <div class="sub-metrics">
              <span>拦截：<strong>{{ summary?.blockedAccessCount ?? 0 }}</strong> 次</span>
              <span class="separator">|</span>
              <span>过滤：<strong>{{ summary?.totalPermissionFilteredCount ?? 0 }}</strong> 段</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 双栏近态跟踪列表 (2列，每列 col-6) -->
      <section class="grid-row">
        <!-- 1. 最近上传文档 -->
        <article class="feed-card col-6">
          <header class="feed-card__head">
            <h3>最近录入文档</h3>
            <button class="text-link" type="button" @click="router.push('/documents')">查看全部</button>
          </header>
          <ul v-if="summary?.recentDocuments?.length" class="doc-feed">
            <li v-for="doc in summary.recentDocuments" :key="doc.id" class="doc-feed-item">
              <div class="doc-feed-item__info">
                <FileTextIcon :size="13" class="doc-icon" />
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
          <p v-else class="empty-feed">暂无最近录入的文档数据</p>
        </article>

        <!-- 2. 最近对话历史 -->
        <article class="feed-card col-6">
          <header class="feed-card__head">
            <h3>最近对话历史</h3>
            <button class="text-link" type="button" @click="router.push('/chat')">查看全部</button>
          </header>
          <ul v-if="summary?.recentConversations?.length" class="chat-feed">
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
              <ChevronRightIcon :size="13" class="arrow-icon" />
            </li>
          </ul>
          <p v-else class="empty-feed">暂无近期对话历史</p>
        </article>
      </section>

      <!-- 下方辅助分析栏 (2列，每列 col-6) -->
      <section class="grid-row">
        <!-- 3. 最近失败详情 -->
        <article class="feed-card col-6">
          <header class="feed-card__head">
            <h3>故障日志记录</h3>
            <button class="text-link" type="button" @click="goDocuments({ status: 'failed' })">查看详情</button>
          </header>
          <ul v-if="summary?.recentFailedDocuments?.length" class="doc-feed">
            <li v-for="doc in summary.recentFailedDocuments" :key="doc.id" class="doc-feed-item">
              <div class="doc-feed-item__info">
                <AlertCircleIcon :size="13" class="doc-icon text-red" />
                <span class="doc-name" :title="doc.filename">{{ doc.filename }}</span>
              </div>
              <span class="time error-log-text" :title="doc.processingError ?? doc.processing_error ?? '解析异常'">
                {{ doc.processingError ?? doc.processing_error ?? '处理失败' }}
              </span>
            </li>
          </ul>
          <p v-else class="empty-feed">近态无资产处理故障</p>
        </article>

        <!-- 4. 热门问题统计 -->
        <article class="feed-card col-6">
          <header class="feed-card__head">
            <h3>热门业务问题追踪</h3>
            <button class="text-link" type="button" @click="router.push('/chat')">发起提问</button>
          </header>
          <ul v-if="summary?.hotQuestions?.length" class="chat-feed">
            <li v-for="item in summary.hotQuestions" :key="item.question" class="chat-feed-item chat-feed-item--no-hover">
              <div class="chat-details">
                <strong class="chat-question">{{ item.question }}</strong>
                <span class="chat-time">业务提问频次：出现 {{ item.count }} 次</span>
              </div>
            </li>
          </ul>
          <p v-else class="empty-feed">暂无高频提问统计</p>
        </article>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircleIcon,
  ChevronRightIcon,
  FileTextIcon,
  LibraryIcon,
  MessageSquareIcon,
  SparklesIcon,
  SearchIcon,
  PlusIcon,
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

// 格式化问答耗时（毫秒转秒）
function formatLatency(ms?: number): string {
  if (!ms) return '0.0'
  const seconds = ms / 1000
  return seconds.toFixed(2)
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

// 文档处理耗时格式化
function formatProcessTime(ms?: number): string {
  if (!ms) return '暂无数据'
  let seconds = ms / 1000
  if (seconds > 3600) {
    seconds = seconds / 1000
  }
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes} 分 ${remainingSeconds} 秒`
}

function latestFailedTrendCount(): number {
  const trend = summary.value?.failedDocumentTrend ?? []
  return trend.length ? trend[trend.length - 1].count : (summary.value?.failedDocumentCount ?? 0)
}
</script>

<style scoped>
/* ── 统一 12 栏标准网格系统 ── */
.grid-row {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 24px;
  width: 100%;
  box-sizing: border-box;
}

.col-12 { grid-column: span 12; }
.col-6  { grid-column: span 6; }
.col-4  { grid-column: span 4; }
.col-3  { grid-column: span 3; }

/* ── 骨架屏 ── */
.skeleton-wrapper {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.skeleton-pulse {
  background: linear-gradient(90deg, rgba(241, 245, 249, 0.4) 25%, rgba(226, 232, 240, 0.6) 50%, rgba(241, 245, 249, 0.4) 75%);
  background-size: 200% 100%;
  animation: skeleton-loading 1.6s infinite ease-in-out;
}

@keyframes skeleton-loading {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* 首页主容器 */
.dashboard {
  padding: 24px;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 24px;
  box-sizing: border-box;
  width: 100%;
}

.dashboard__body {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
}

/* 头部 Header */
.dashboard__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 4px;
}

.dashboard__head h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.02em;
  text-align: left;
}

.subtitle {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
  text-align: left;
}

/* 按钮设计 */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  background: var(--primary-gradient);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 12.5px;
  font-weight: 750;
  cursor: pointer;
  box-shadow: var(--shadow-btn);
  transition: all 0.25s var(--ease-out);
  flex-shrink: 0;
}

.btn-primary:hover {
  transform: translateY(-1.5px);
  box-shadow: var(--shadow-btn-hover);
  filter: brightness(1.03);
}

/* 快捷向导卡片 */
.quick-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 20px;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(226, 232, 240, 0.6);
  cursor: pointer;
  transition: all 0.25s var(--ease-out);
  text-align: left;
}

.quick-card:hover {
  transform: translateY(-2px);
  border-color: rgba(59, 130, 246, 0.25);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
}

.quick-card__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  margin-bottom: 12px;
}

.bg-step1 { background: rgba(59, 130, 246, 0.08); color: var(--primary); }
.bg-step2 { background: rgba(168, 85, 247, 0.08); color: #9333ea; }
.bg-step3 { background: rgba(20, 184, 166, 0.08); color: #0d9488; }

.quick-card__info h4 {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 750;
  color: var(--text);
}

.quick-card__info p {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.55;
  min-height: 38px;
}

.quick-card__link {
  font-size: 11.5px;
  font-weight: 750;
  color: var(--primary);
  margin-top: auto;
  transition: transform 0.2s ease;
}

.quick-card:hover .quick-card__link {
  transform: translateX(2px);
}

/* 4格整合核心统计指标架 */
.stat-card-opt {
  display: flex;
  flex-direction: column;
  padding: 18px 20px;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 20px rgba(15, 23, 42, 0.015);
  transition: all 0.25s var(--ease-out);
  text-align: left;
}

.stat-card-opt:hover {
  transform: translateY(-2px);
  border-color: rgba(59, 130, 246, 0.25);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.04);
}

.stat-card-opt.has-alert {
  border-color: rgba(239, 68, 68, 0.25);
  background: rgba(254, 242, 242, 0.35);
}

.stat-card-opt.has-alert:hover {
  border-color: rgba(239, 68, 68, 0.45);
}

.stat-card-opt__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.stat-card-opt__header .title {
  font-size: 11px;
  font-weight: 750;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.stat-card-opt__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stat-card-opt__body .metric {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.stat-card-opt__body .number {
  font-size: 28px;
  font-weight: 850;
  color: var(--text);
  line-height: 1;
}

.stat-card-opt__body .unit {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
}

.stat-card-opt__body .sub-metrics {
  font-size: 11.5px;
  color: var(--text-muted);
  display: flex;
  gap: 6px;
  align-items: center;
}

.stat-card-opt__body .separator {
  color: rgba(226, 232, 240, 0.8);
}

.icon-blue { color: #2563eb; }
.icon-teal { color: #0d9488; }
.icon-indigo { color: #4f46e5; }
.icon-green { color: #059669; }
.icon-red { color: #dc2626; }

/* 双栏动态内容追踪 */
.feed-card {
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: 0 4px 20px rgba(15, 23, 42, 0.01);
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
  border-bottom: 1px solid rgba(226, 232, 240, 0.5);
}

.feed-card__head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 750;
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
  padding: 10px 14px;
  background: rgba(248, 250, 252, 0.5);
  border-radius: 8px;
  border: 1px solid rgba(226, 232, 240, 0.3);
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
  font-weight: 650;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
  text-align: left;
}

.error-log-text {
  display: inline-block;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-muted);
  text-align: right;
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
  font-size: 10.5px;
  color: var(--text-muted);
}

.chat-feed-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #ffffff;
  border: 1px solid rgba(226, 232, 240, 0.6);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.chat-feed-item:hover:not(.chat-feed-item--no-hover) {
  background: rgba(248, 250, 252, 0.6);
  border-color: rgba(59, 130, 246, 0.25);
  transform: translateX(1px);
}

.chat-feed-item--no-hover {
  cursor: default;
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
  text-align: left;
}

.chat-question {
  font-size: 12.5px;
  font-weight: 650;
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
  border: 1px dashed rgba(226, 232, 240, 0.6);
  border-radius: 8px;
  margin: 0;
  min-height: 120px;
}

.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 32px;
  background: rgba(255, 255, 255, 0.55);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(226, 232, 240, 0.6);
  min-height: 320px;
}

.error-icon {
  color: var(--error);
  margin-bottom: 12px;
}

.error-state p {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0 0 16px;
}

.btn-ghost {
  padding: 8px 16px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-ghost:hover {
  background: rgba(59, 130, 246, 0.05);
  color: var(--primary);
}

/* ── 响应式 12 栏网格规则 ── */
@media (max-width: 1024px) {
  .col-3 {
    grid-column: span 6; /* 4 列在大屏变为 2 列 */
  }
  .col-4 {
    grid-column: span 12; /* 3 列向导在平板直接垂直单列，规避最后一张卡片孤立掉行的问题 */
  }
  .col-6 {
    grid-column: span 12; /* 双栏变为单栏 */
  }
}

@media (max-width: 640px) {
  .col-3, .col-4, .col-6 {
    grid-column: span 12; /* 手机端全部平铺 */
  }
}
</style>
