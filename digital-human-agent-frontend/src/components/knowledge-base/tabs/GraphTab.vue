<template>
  <div class="graph-tab">
    <!-- 头部工具栏 -->
    <header class="graph-header">
      <div class="search-box">
        <input
          type="text"
          v-model="searchQuery"
          placeholder="搜索图谱实体 (如：乔峰)..."
          @input="onSearchInput"
        />
        <span class="search-icon">🔍</span>
      </div>
      <button
        v-if="canRebuildGraph"
        class="btn-rebuild"
        type="button"
        @click="handleRebuild"
        :disabled="rebuilding"
      >
        {{ rebuilding ? '正在重建图谱关系…' : '🔄 重建图谱关系' }}
      </button>
    </header>

    <!-- 主体容器 -->
    <div class="graph-body">
      <!-- 左侧：实体列表 -->
      <aside class="entity-aside">
        <h3>图谱实体 ({{ filteredEntities.length }})</h3>
        <ul v-if="filteredEntities.length" class="entity-list">
          <li
            v-for="ent in filteredEntities"
            :key="ent.key"
            :class="{ 'entity--active': selectedEntity?.key === ent.key }"
            @click="selectEntity(ent)"
          >
            <div class="entity-name">{{ ent.name }}</div>
            <div class="entity-key">{{ ent.key }}</div>
          </li>
        </ul>
        <p v-else-if="loadingEntities" class="tip-msg">正在加载实体…</p>
        <p v-else class="tip-msg">未找到匹配的图实体</p>
      </aside>

      <!-- 右侧：关系证据与邻居 -->
      <main class="relation-main">
        <div v-if="selectedEntity" class="neighborhood-view">
          <header class="neighborhood-head">
            <h3>
              实体：<span>{{ selectedEntity.name }}</span> 的邻域关系
            </h3>
          </header>

          <div v-if="loadingRelations" class="tip-msg">正在加载关系证据…</div>
          <div v-else-if="relations.length === 0" class="tip-msg">
            该实体暂无一跳关联证据
          </div>

          <div v-else class="relations-grid">
            <div
              v-for="rel in relations"
              :key="rel.id"
              class="relation-card"
            >
              <div class="relation-meta">
                <span class="badge-category">{{ rel.category || 'Text' }}</span>
                <span class="badge-confidence">
                  置信度: {{ (rel.confidence * 100).toFixed(0) }}%
                </span>
              </div>
              <p class="evidence-text">
                "{{ rel.evidenceText || rel.content || '暂无证据文本' }}"
              </p>
              <div class="relation-foot">
                <span class="source-doc">来源: {{ rel.source }}</span>
                <button
                  type="button"
                  class="btn-preview"
                  @click="previewChunk(rel)"
                >
                  📖 查看详情分片
                </button>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <div class="empty-icon">🕸️</div>
          <p>请在左侧选择一个图实体查看其一跳关联及证据</p>
        </div>
      </main>
    </div>

    <!-- 侧边预览抽屉 -->
    <div v-if="previewingChunk" class="preview-drawer-overlay" @click.self="previewingChunk = null">
      <div class="preview-drawer">
        <header class="drawer-header">
          <h3>文档片段详情 (ID: {{ previewingChunk.id }})</h3>
          <button class="btn-close" @click="previewingChunk = null">❌</button>
        </header>
        <div class="drawer-content">
          <div class="meta-item">
            <strong>所属文档:</strong> <span>{{ previewingChunk.source }}</span>
          </div>
          <div class="meta-item">
            <strong>分片序号:</strong> <span>#{{ previewingChunk.chunk_index }}</span>
          </div>
          <div class="meta-item">
            <strong>分片类型:</strong> <span>{{ previewingChunk.category || '文本' }}</span>
          </div>
          <div class="meta-item">
            <strong>置信度:</strong> <span>{{ (previewingChunk.confidence * 100).toFixed(0) }}%</span>
          </div>
          <div class="evidence-box">
            <strong>证据文本:</strong>
            <p>{{ previewingChunk.evidenceText || '无' }}</p>
          </div>
          <div class="content-box">
            <strong>完整分片内容:</strong>
            <pre>{{ previewingChunk.content }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { usePermissions } from '@/hooks/usePermissions'

const props = defineProps<{ kbId: string }>()
const hook = useKnowledgeBase()
const permissionApi = usePermissions()
const canRebuildGraph = computed(() => permissionApi.can('documents:retry'))

const searchQuery = ref('')
const rebuilding = ref(false)
const loadingEntities = ref(false)
const loadingRelations = ref(false)

const entities = ref<any[]>([])
const filteredEntities = ref<any[]>([])
const selectedEntity = ref<any | null>(null)
const relations = ref<any[]>([])

const previewingChunk = ref<any | null>(null)

// 加载实体列表
async function loadEntities() {
  loadingEntities.value = true
  try {
    const list = await hook.listGraphEntities(props.kbId, '', 100)
    entities.value = list
    filteredEntities.value = list
  } finally {
    loadingEntities.value = false
  }
}

// 搜索实体
function onSearchInput() {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) {
    filteredEntities.value = entities.value
    return
  }
  filteredEntities.value = entities.value.filter(
    (e) =>
      (e.name && e.name.toLowerCase().includes(q)) ||
      (e.key && e.key.toLowerCase().includes(q)),
  )
}

// 选择某个实体查看一跳邻居关系
async function selectEntity(ent: any) {
  selectedEntity.value = ent
  loadingRelations.value = true
  try {
    const list = await hook.getGraphNeighborhood(props.kbId, ent.key)
    relations.value = list
  } finally {
    loadingRelations.value = false
  }
}

// 一键重建图谱关系
async function handleRebuild() {
  if (!confirm('确定要全量擦除并重新提取该知识库的图谱关系吗？这可能会花费一些时间。')) {
    return
  }
  rebuilding.value = true
  try {
    const res = await hook.rebuildGraph(props.kbId)
    if (res.success) {
      alert('图谱重建任务提交成功！')
      selectedEntity.value = null
      relations.value = []
      await loadEntities()
    } else {
      alert('图谱重建失败，请稍后重试')
    }
  } catch (err) {
    alert('请求失败：' + (err instanceof Error ? err.message : String(err)))
  } finally {
    rebuilding.value = false
  }
}

// 查看分片详情
function previewChunk(chunk: any) {
  previewingChunk.value = chunk
}

onMounted(() => {
  void permissionApi.loadPermissions()
  void loadEntities()
})
watch(() => props.kbId, () => {
  selectedEntity.value = null
  relations.value = []
  loadEntities()
})
</script>

<style scoped>
.graph-tab {
  display: flex;
  flex-direction: column;
  height: 600px;
  overflow: hidden;
  font-family: inherit;
}
.graph-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}
.search-box {
  position: relative;
  flex: 1;
  max-width: 400px;
}
.search-box input {
  width: 100%;
  height: 38px;
  padding: 0 16px 0 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 13px;
  outline: none;
  background: var(--surface-soft);
  transition: all 0.2s ease;
}
.search-box input:focus {
  border-color: var(--primary);
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}
.search-icon {
  position: absolute;
  left: 12px;
  top: 10px;
  font-size: 14px;
}
.btn-rebuild {
  height: 38px;
  padding: 0 16px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-md);
  background: #ffffff;
  color: var(--primary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
}
.btn-rebuild:hover:not(:disabled) {
  background: var(--primary-gradient);
  color: #ffffff;
  transform: translateY(-1px);
}
.btn-rebuild:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.graph-body {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 20px;
}
.entity-aside {
  width: 240px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  padding-right: 16px;
}
.entity-aside h3 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}
.entity-list {
  flex: 1;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.entity-list li {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;
}
.entity-list li:hover {
  background: var(--surface-soft);
}
.entity--active {
  background: rgba(99, 102, 241, 0.08) !important;
  border-color: rgba(99, 102, 241, 0.3) !important;
}
.entity-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 2px;
}
.entity-key {
  font-size: 10px;
  color: var(--text-muted);
  word-break: break-all;
}
.relation-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.neighborhood-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.neighborhood-head {
  margin-bottom: 16px;
}
.neighborhood-head h3 {
  margin: 0;
  font-size: 15px;
  color: var(--text);
}
.neighborhood-head h3 span {
  color: var(--primary);
  font-weight: 800;
}
.relations-grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
  padding-bottom: 16px;
}
.relation-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: all 0.2s ease;
}
.relation-card:hover {
  box-shadow: var(--shadow-md);
  border-color: rgba(99, 102, 241, 0.2);
}
.relation-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.badge-category {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-soft);
  color: var(--text-secondary);
}
.badge-confidence {
  font-size: 11px;
  color: var(--primary);
  font-weight: 700;
}
.evidence-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  margin: 0;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.relation-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--border);
  padding-top: 8px;
  font-size: 11px;
}
.source-doc {
  color: var(--text-muted);
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.btn-preview {
  background: none;
  border: none;
  color: var(--primary);
  cursor: pointer;
  font-weight: 700;
}
.btn-preview:hover {
  text-decoration: underline;
}
.tip-msg {
  color: var(--text-muted);
  font-size: 13px;
  padding: 24px 0;
  text-align: center;
}
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  text-align: center;
}
.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}
.preview-drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
}
.preview-drawer {
  width: 460px;
  height: 100%;
  background: #ffffff;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  padding: 24px;
  animation: slideIn 0.3s ease;
}
@keyframes slideIn {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
  padding-bottom: 14px;
  margin-bottom: 18px;
}
.drawer-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
}
.btn-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
}
.drawer-content {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.meta-item {
  font-size: 13px;
}
.meta-item strong {
  display: inline-block;
  width: 80px;
  color: var(--text-secondary);
}
.evidence-box,
.content-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.evidence-box p {
  padding: 10px;
  background: var(--surface-soft);
  border-left: 3px solid var(--primary);
  margin: 0;
  border-radius: 4px;
  font-style: italic;
}
.content-box pre {
  padding: 12px;
  background: #1e293b;
  color: #e2e8f0;
  font-family: monospace;
  font-size: 12px;
  border-radius: 6px;
  overflow-x: auto;
  white-space: pre-wrap;
  margin: 0;
}
</style>
