<template>
  <section class="health">
    <!-- 阶段 7 核心交付：后端 6 大核心依赖组件运行诊断 -->
    <div class="backend-health-card">
      <header class="card-title">
        <h3>💻 后端核心系统组件运行诊断</h3>
        <span class="diagnostic-time" v-if="healthData">诊断时间: {{ formatTime(healthData.timestamp) }}</span>
      </header>

      <div v-if="loadingHealth" class="health-loading">正在对后台系统执行微秒级穿透式体检…</div>
      <div v-else-if="healthError" class="health-error-banner">
        ⚠️ 后台健康状态获取失败: {{ healthError }}
      </div>

      <div v-else-if="healthData" class="system-status-grid">
        <!-- 数据库 -->
        <article class="status-node" :class="'status--' + (healthData.checks.db?.status || 'error')">
          <div class="node-head">
            <span class="indicator"></span>
            <h4>关系型数据库 (PG)</h4>
          </div>
          <div class="node-body">
            <p>连接状态: <strong>{{ healthData.checks.db?.status === 'ok' ? '健康' : '失联' }}</strong></p>
            <p v-if="healthData.checks.db?.latencyMs !== undefined">
              数据库延迟: <strong>{{ healthData.checks.db.latencyMs }}ms</strong>
            </p>
          </div>
        </article>

        <!-- 搜索引擎 -->
        <article class="status-node" :class="'status--' + (healthData.checks.elasticsearch?.status || 'error')">
          <div class="node-head">
            <span class="indicator"></span>
            <h4>搜索引擎 (ES)</h4>
          </div>
          <div class="node-body">
            <p>检索状态: <strong>{{ healthData.checks.elasticsearch?.status === 'ok' ? '正常' : '不可用' }}</strong></p>
            <p v-if="healthData.checks.elasticsearch?.latencyMs !== undefined">
              ES 响应延迟: <strong>{{ healthData.checks.elasticsearch.latencyMs }}ms</strong>
            </p>
          </div>
        </article>

        <!-- 图数据库 -->
        <article class="status-node" :class="'status--' + (healthData.checks.neo4j?.status || 'error')">
          <div class="node-head">
            <span class="indicator"></span>
            <h4>图数据库 (Neo4j)</h4>
          </div>
          <div class="node-body">
            <p>图谱服务: <strong>{{ healthData.checks.neo4j?.status === 'ok' ? '正常' : '未同步/脱机' }}</strong></p>
            <p v-if="healthData.checks.neo4j?.latencyMs !== undefined">
              查询延迟: <strong>{{ healthData.checks.neo4j.latencyMs }}ms</strong>
            </p>
            <p v-if="healthData.checks.neo4j?.status !== 'ok'" class="error-msg">
              {{ healthData.checks.neo4j?.message }}
            </p>
          </div>
        </article>

        <!-- 缓存与积压队列 -->
        <article class="status-node" :class="'status--' + (healthData.checks.redis?.status || 'error')">
          <div class="node-head">
            <span class="indicator"></span>
            <h4>缓存与任务队列 (Redis)</h4>
          </div>
          <div class="node-body">
            <p>服务状态: <strong>{{ healthData.checks.redis?.status === 'ok' ? '健康' : '断连' }}</strong></p>
            <p v-if="healthData.checks.redis?.latencyMs !== undefined">
              缓存时延: <strong>{{ healthData.checks.redis.latencyMs }}ms</strong>
            </p>
            <p>
              排队未消费任务:
              <strong :class="{ 'warning-text': (healthData.checks.redis?.queueDelayCount || 0) > 0 }">
                {{ healthData.checks.redis?.queueDelayCount ?? 0 }} 个
              </strong>
            </p>
          </div>
        </article>

        <!-- 对象存储 -->
        <article class="status-node" :class="'status--' + (healthData.checks.minio?.status || 'error')">
          <div class="node-head">
            <span class="indicator"></span>
            <h4>对象存储 (MinIO)</h4>
          </div>
          <div class="node-body">
            <p>桶读写权: <strong>{{ healthData.checks.minio?.status === 'ok' ? '正常' : '异常' }}</strong></p>
            <p v-if="healthData.checks.minio?.latencyMs !== undefined">
              S3 时延: <strong>{{ healthData.checks.minio.latencyMs }}ms</strong>
            </p>
          </div>
        </article>

        <!-- 任务处理执行器 -->
        <article class="status-node" :class="'status--' + (healthData.checks.worker?.status || 'error')">
          <div class="node-head">
            <span class="indicator"></span>
            <h4>任务执行器 (Worker)</h4>
          </div>
          <div class="node-body">
            <p>消费心跳: <strong>{{ healthData.checks.worker?.status === 'ok' ? '活动中' : '无心跳' }}</strong></p>
            <p v-if="healthData.checks.worker?.lastTaskProcessedAt">
              最近任务时间: <span class="time-stamp">{{ formatTime(healthData.checks.worker.lastTaskProcessedAt) }}</span>
            </p>
          </div>
        </article>
      </div>
    </div>

    <!-- 基础风险统计 -->
    <div class="health-grid">
      <article class="metric">
        <span>失败文档</span>
        <strong>{{ failedDocuments.length }}</strong>
      </article>
      <article class="metric">
        <span>无片段文档</span>
        <strong>{{ emptyChunkDocuments.length }}</strong>
      </article>
      <article class="metric">
        <span>图谱失败</span>
        <strong>{{ graphFailedDocuments.length }}</strong>
      </article>
      <article class="metric">
        <span>验证通过率</span>
        <strong>{{ passRate }}</strong>
      </article>
    </div>

    <!-- 底部双面板 -->
    <div class="health-columns">
      <article class="panel">
        <header>
          <h3>需要处理的文档</h3>
          <button type="button" @click="goDocuments">打开文档管理</button>
        </header>
        <ol v-if="riskDocuments.length" class="risk-list">
          <li v-for="doc in riskDocuments" :key="doc.id">
            <strong>{{ doc.filename }}</strong>
            <span>{{ describeDocumentRisk(doc) }}</span>
          </li>
        </ol>
        <p v-else class="empty">暂无文档风险项</p>
      </article>

      <article class="panel">
        <header>
          <h3>最近低分验证</h3>
          <button type="button" @click="runBatch" :disabled="running || !evalCases.length">
            {{ running ? '运行中' : '批量运行' }}
          </button>
        </header>
        <ol v-if="failedEvalCases.length" class="risk-list">
          <li v-for="item in failedEvalCases" :key="item.id">
            <strong>{{ item.question }}</strong>
            <span>{{ item.lastRunError ?? item.last_run_error ?? '验证未通过' }}</span>
          </li>
        </ol>
        <p v-else class="empty">暂无低分验证用例</p>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { apiJson } from '@/api/client'
import type { KnowledgeDocumentDetail, KnowledgeEvalCase } from '@/types'

const props = defineProps<{ kbId: string }>()
const router = useRouter()
const hook = useKnowledgeBase()

const documents = ref<KnowledgeDocumentDetail[]>([])
const evalCases = ref<KnowledgeEvalCase[]>([])
const running = ref(false)

// 健康检查数据
const healthData = ref<any | null>(null)
const loadingHealth = ref(false)
const healthError = ref<string | null>(null)

const failedDocuments = computed(() => documents.value.filter((doc) => doc.status === 'failed'))
const emptyChunkDocuments = computed(() =>
  documents.value.filter((doc) => doc.status === 'completed' && (doc.chunkCount ?? doc.chunk_count ?? 0) === 0),
)
const graphFailedDocuments = computed(() =>
  documents.value.filter((doc) => (doc.graphSyncStatus ?? doc.graph_sync_status) === 'failed'),
)
const riskDocuments = computed(() =>
  [...failedDocuments.value, ...emptyChunkDocuments.value, ...graphFailedDocuments.value].slice(0, 8),
)
const failedEvalCases = computed(() =>
  evalCases.value
    .filter((item) => (item.lastRunStatus ?? item.last_run_status) === 'failed')
    .slice(0, 8),
)
const passRate = computed(() => {
  const reviewed = evalCases.value.filter((item) => item.userReviewStatus ?? item.user_review_status)
  const total = reviewed.length || evalCases.value.length
  if (!total) return '0%'
  const passed = evalCases.value.filter((item) => {
    const status = item.userReviewStatus ?? item.user_review_status ?? item.lastRunStatus ?? item.last_run_status
    return status === 'passed'
  }).length
  return `${Math.round((passed / total) * 100)}%`
})

onMounted(() => {
  load()
  loadHealthDiagnostic()
})

async function load() {
  const [docResult, cases] = await Promise.all([
    hook.listDocumentsPaged(props.kbId, { page: 1, pageSize: 200 }),
    hook.listEvalCases(props.kbId),
  ])
  documents.value = docResult.items
  evalCases.value = cases
}

// 请求阶段 7 后端编写的微秒级自愈健康检查
async function loadHealthDiagnostic() {
  loadingHealth.value = true
  healthError.value = null
  try {
    const res = await apiJson<any>('/api/health')
    healthData.value = res
  } catch (err) {
    // 捕获可能抛出的 503 等未完全健康异常，尝试从 response 中还原检查详情
    const responseErr = err as { response?: { checks?: any } }
    if (responseErr.response && responseErr.response.checks) {
      healthData.value = responseErr.response
    } else {
      healthError.value = err instanceof Error ? err.message : String(err)
    }
  } finally {
    loadingHealth.value = false
  }
}

async function runBatch() {
  running.value = true
  try {
    evalCases.value = await hook.runEvalBatch(props.kbId)
  } finally {
    running.value = false
  }
}

function goDocuments() {
  router.push({ path: '/documents', query: { knowledgeBaseId: props.kbId, status: 'failed' } })
}

function describeDocumentRisk(doc: KnowledgeDocumentDetail) {
  if (doc.status === 'failed') {
    return doc.processingError ?? doc.processing_error ?? '处理失败'
  }
  if ((doc.chunkCount ?? doc.chunk_count ?? 0) === 0) return '没有可检索片段'
  if ((doc.graphSyncStatus ?? doc.graph_sync_status) === 'failed') {
    return doc.graphSyncError ?? doc.graph_sync_error ?? '图谱同步失败'
  }
  return '需要检查'
}

function formatTime(isoStr?: string): string {
  if (!isoStr) return '无'
  try {
    const d = new Date(isoStr)
    return `${d.toLocaleDateString()} ${d.toTimeString().slice(0, 8)}`
  } catch (err) {
    return isoStr
  }
}
</script>

<style scoped>
.health {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.backend-health-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 16px;
}
.card-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border);
  padding-bottom: 10px;
  margin-bottom: 14px;
}
.card-title h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}
.diagnostic-time {
  font-size: 11px;
  color: var(--text-muted);
}
.health-loading,
.health-error-banner {
  font-size: 12px;
  padding: 12px;
  text-align: center;
}
.health-loading {
  color: var(--text-muted);
}
.health-error-banner {
  color: #ef4444;
  background: #fef2f2;
  border-radius: 6px;
}
.system-status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.status-node {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-soft);
  padding: 12px;
}
.node-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.node-head h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
}
.indicator {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #94a3b8;
}
.status--ok .indicator {
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
}
.status--error .indicator {
  background: #ef4444;
  box-shadow: 0 0 8px #ef4444;
}
.node-body {
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.node-body p {
  margin: 0 0 4px;
}
.warning-text {
  color: #f59e0b;
}
.time-stamp {
  font-family: monospace;
}
.error-msg {
  color: #ef4444;
  font-size: 10px;
}
.health-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}
.metric,
.panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.metric {
  display: flex;
  min-height: 96px;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 16px;
}
.metric span,
.risk-list span,
.empty {
  color: var(--text-muted);
  font-size: 12px;
}
.metric strong {
  font-size: 26px;
}
.health-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.panel {
  padding: 16px;
}
.panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.panel h3 {
  margin: 0;
  font-size: 15px;
}
.panel button {
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--primary);
  border-radius: 7px;
  background: #fff;
  color: var(--primary);
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}
.panel button:hover {
  background: var(--primary);
  color: #fff;
}
.risk-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.risk-list li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border-radius: 8px;
  background: var(--surface-soft);
}
@media (max-width: 900px) {
  .health-columns {
    grid-template-columns: 1fr;
  }
}
</style>
