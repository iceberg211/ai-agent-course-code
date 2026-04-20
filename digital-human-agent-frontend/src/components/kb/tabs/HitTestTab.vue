<template>
  <div class="hit-test">
    <section class="search-panel" aria-label="知识库检索测试">
      <div class="search-panel__copy">
        <p class="eyebrow">命中测试</p>
        <h3>验证问题会命中哪些片段</h3>
        <p>用于检查召回阈值、候选数量和重排结果，调整后不会自动保存到知识库配置。</p>
      </div>

      <div class="query-row">
        <label class="query-field">
          <span class="sr-only">测试问题</span>
          <input
            v-model="query"
            type="text"
            placeholder="输入一个真实用户问题"
            :disabled="hook.searching.value"
            @keydown.enter="runSearch"
          />
        </label>
        <button class="btn-primary" :disabled="!canSearch" @click="runSearch">
          <SearchIcon :size="15" />
          {{ hook.searching.value ? '检索中' : '运行测试' }}
        </button>
      </div>

      <div class="params" aria-label="临时检索参数">
        <label class="param param--threshold">
          <span class="param__label">阈值</span>
          <input v-model.number="threshold" type="range" min="0" max="1" step="0.05" />
          <strong>{{ threshold.toFixed(2) }}</strong>
        </label>
        <label class="param">
          <span class="param__label">候选数</span>
          <input v-model.number="stage1TopK" type="number" min="1" max="50" step="1" />
        </label>
        <label class="param">
          <span class="param__label">最终数</span>
          <input v-model.number="finalTopK" type="number" min="1" max="20" step="1" />
        </label>
        <label class="switch">
          <input v-model="rerank" type="checkbox" />
          <span>重排</span>
        </label>
        <button class="btn-ghost" type="button" @click="resetParams">恢复默认</button>
      </div>
      <p v-if="errorMsg" class="error" role="alert">{{ errorMsg }}</p>
    </section>

    <section v-if="result" class="results">
      <div class="results__head">
        <div>
          <p class="eyebrow">检索结果</p>
          <h3>{{ result.query }}</h3>
        </div>
        <dl class="metrics">
          <div>
            <dt>召回</dt>
            <dd>{{ result.stage1.length }}</dd>
          </div>
          <div>
            <dt>最终</dt>
            <dd>{{ result.stage2.length }}</dd>
          </div>
          <div>
            <dt>模式</dt>
            <dd>{{ result.options?.rerank ? 'Rerank' : '截断' }}</dd>
          </div>
          <div v-if="result.debugTrace">
            <dt>置信度</dt>
            <dd>{{ result.debugTrace.lowConfidence ? '偏低' : '正常' }}</dd>
          </div>
        </dl>
      </div>

      <section v-if="result.debugTrace" class="trace-panel" aria-label="检索过程">
        <header class="trace-panel__head">
          <div>
            <p class="eyebrow">检索过程</p>
            <h4>{{ result.debugTrace.rewrittenQuery || result.debugTrace.originalQuery }}</h4>
          </div>
          <span>{{ result.debugTrace.retrievalMode }}</span>
        </header>
        <div class="trace-meta">
          <span>Trace {{ result.debugTrace.traceId }}</span>
          <span v-if="result.debugTrace.lowConfidenceReason">
            低置信原因 {{ result.debugTrace.lowConfidenceReason }}
          </span>
          <span v-if="result.debugTrace.timingsMs.total != null">
            总耗时 {{ Math.round(result.debugTrace.timingsMs.total) }}ms
          </span>
        </div>
        <ol class="stage-list">
          <li v-for="stage in result.debugTrace.stages" :key="stage.name">
            <span class="stage-dot" :class="{ 'stage-dot--skip': stage.skipped }"></span>
            <strong>{{ stageNameLabel(stage.name) }}</strong>
            <small>
              {{ stage.skipped ? stage.skipReason || '已跳过' : '已执行' }}
              <template v-if="stage.latencyMs != null"> · {{ Math.round(stage.latencyMs) }}ms</template>
            </small>
          </li>
        </ol>
      </section>

      <div class="results__columns">
        <article class="result-list">
          <header class="result-list__head">
            <span>Stage 1</span>
            <strong>向量召回</strong>
          </header>
          <ol v-if="result.stage1.length" class="hit-list">
            <li
              v-for="(c, index) in result.stage1"
              :key="`s1-${c.id}`"
              :class="{ 'is-active': selected?.id === c.id }"
            >
              <button type="button" @click="selected = c">
                <span class="rank">{{ index + 1 }}</span>
                <span class="hit-copy">
                  <strong>{{ c.source }}</strong>
                  <small>第 {{ c.chunk_index + 1 }} 段 · 相似度 {{ fmt(c.similarity) }}</small>
                </span>
              </button>
            </li>
          </ol>
          <p v-else class="muted">无结果</p>
        </article>
        <article class="result-list result-list--final">
          <header class="result-list__head">
            <span>Stage 2</span>
            <strong>{{ result.options?.rerank ? '重排结果' : '最终结果' }}</strong>
          </header>
          <ol v-if="result.stage2.length" class="hit-list">
            <li
              v-for="(c, index) in result.stage2"
              :key="`s2-${c.id}`"
              :class="{ 'is-active': selected?.id === c.id }"
            >
              <button type="button" @click="selected = c">
                <span class="rank">{{ index + 1 }}</span>
                <span class="hit-copy">
                  <strong>{{ c.source }}</strong>
                  <small>
                    第 {{ c.chunk_index + 1 }} 段
                    <template v-if="c.rerank_score != null"> · 重排 {{ fmt(c.rerank_score) }}</template>
                    · 相似度 {{ fmt(c.similarity) }}
                  </small>
                </span>
              </button>
            </li>
          </ol>
          <p v-else class="muted">无结果</p>
        </article>
      </div>

      <aside v-if="selected" class="detail" aria-label="命中内容">
        <header>
          <div>
            <p class="eyebrow">命中内容</p>
            <h4>{{ selected.source }}</h4>
          </div>
          <span>第 {{ selected.chunk_index + 1 }} 段</span>
        </header>
        <pre>{{ selected.content }}</pre>
      </aside>
    </section>
    <section v-else class="empty-state" aria-label="空状态">
      <SearchIcon :size="22" />
      <p>输入一个问题后运行测试</p>
      <span>这里会展示向量召回、重排结果和最终用于回答的片段。</span>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { SearchIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '../../../hooks/useKnowledgeBase'
import type {
  KnowledgeBase,
  KnowledgeSearchChunk,
  KnowledgeSearchResult,
} from '../../../types'

const props = defineProps<{ kb: KnowledgeBase }>()
const hook = useKnowledgeBase()

const query = ref('')
const threshold = ref(props.kb.retrievalConfig.threshold)
const stage1TopK = ref(props.kb.retrievalConfig.stage1TopK)
const finalTopK = ref(props.kb.retrievalConfig.finalTopK)
const rerank = ref(props.kb.retrievalConfig.rerank)

const result = ref<KnowledgeSearchResult | null>(null)
const selected = ref<KnowledgeSearchChunk | null>(null)
const errorMsg = ref('')

const canSearch = computed(
  () => !hook.searching.value && query.value.trim().length > 0,
)

watch(
  () => props.kb.id,
  () => {
    query.value = ''
    result.value = null
    selected.value = null
    resetParams()
  },
)

function resetParams() {
  threshold.value = props.kb.retrievalConfig.threshold
  stage1TopK.value = props.kb.retrievalConfig.stage1TopK
  finalTopK.value = props.kb.retrievalConfig.finalTopK
  rerank.value = props.kb.retrievalConfig.rerank
}

async function runSearch() {
  if (!canSearch.value) return
  selected.value = null
  errorMsg.value = ''
  const r = await hook.searchInKb(props.kb.id, query.value, {
    threshold: threshold.value,
    stage1TopK: stage1TopK.value,
    finalTopK: finalTopK.value,
    rerank: rerank.value,
  })
  if (!r) {
    result.value = null
    errorMsg.value = '检索失败，请检查后端服务或模型配置'
    return
  }
  result.value = r
  selected.value = r.stage2[0] ?? r.stage1[0] ?? null
}

function fmt(n: number | undefined): string {
  const v = Number(n)
  return Number.isFinite(v) ? v.toFixed(3) : '-'
}

function stageNameLabel(name: string): string {
  const labels: Record<string, string> = {
    query_rewrite: 'Query Rewrite',
    vector_retrieval: '向量召回',
    keyword_retrieval: '关键词召回',
    fusion: '融合',
    rerank: '重排',
    multi_hop: '多跳',
    web_fallback: '联网补充',
    context_assembly: '上下文组装',
    generation: '生成',
  }
  return labels[name] ?? name
}
</script>

<style scoped>
.hit-test {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 2px 0 20px;
}

.search-panel,
.results,
.empty-state {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.search-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
}

.search-panel__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.eyebrow {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.search-panel h3,
.results__head h3,
.detail h4 {
  margin: 0;
  color: var(--text);
  font-weight: 700;
  letter-spacing: 0;
}

.search-panel h3 { font-size: 17px; }
.search-panel p:not(.eyebrow) {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.query-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
}

.query-field {
  display: block;
  min-width: 0;
}

.query-field input {
  width: 100%;
  height: 44px;
  padding: 0 13px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font: inherit;
  font-size: 14px;
  color: var(--text);
  background: #fff;
}

.query-field input:focus,
.param input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.13);
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 112px;
  height: 44px;
  padding: 0 18px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 150ms ease, box-shadow 150ms ease;
}
.btn-primary:hover:not(:disabled) {
  background: var(--primary-hover);
  box-shadow: var(--shadow-btn);
}
.btn-primary:disabled { opacity: 0.48; cursor: not-allowed; }

.params {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) repeat(2, 112px) auto auto;
  gap: 10px;
  align-items: end;
}

.param {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.param__label {
  font-size: 12px;
  color: var(--text-muted);
}

.param input[type='number'] {
  width: 100%;
  height: 34px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
  color: var(--text);
}

.param--threshold {
  display: grid;
  grid-template-columns: auto minmax(96px, 1fr) 42px;
  align-items: center;
  gap: 8px;
  height: 34px;
}

.param--threshold .param__label {
  font-size: 12px;
}

.param--threshold input {
  accent-color: var(--primary);
}

.param--threshold strong {
  font-size: 12px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.switch {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  background: var(--surface-soft);
}

.switch input {
  accent-color: var(--primary);
}

.btn-ghost {
  height: 34px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.btn-ghost:hover { background: var(--primary-bg); color: var(--primary); }

.error {
  margin: 0;
  color: var(--error);
  font-size: 12px;
}

.results {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.results__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-muted);
}

.results__head h3 {
  margin-top: 1px;
  font-size: 16px;
}

.metrics {
  display: flex;
  gap: 8px;
  margin: 0;
}

.metrics div {
  min-width: 68px;
  padding: 7px 10px;
  border: 1px solid var(--border-muted);
  border-radius: 8px;
  background: var(--surface-soft);
}

.metrics dt {
  font-size: 10px;
  color: var(--text-muted);
}

.metrics dd {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.trace-panel {
  border: 1px solid var(--border-muted);
  border-radius: 8px;
  padding: 12px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.trace-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.trace-panel h4 {
  margin: 1px 0 0;
  color: var(--text);
  font-size: 14px;
  letter-spacing: 0;
}

.trace-panel__head > span {
  padding: 3px 8px;
  border-radius: 7px;
  background: var(--surface-soft);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
}

.trace-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11px;
}

.trace-meta span {
  padding: 3px 7px;
  border-radius: 7px;
  background: var(--surface-soft);
}

.stage-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 6px;
}

.stage-list li {
  min-width: 0;
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr);
  gap: 7px;
  align-items: center;
  padding: 7px 8px;
  border: 1px solid var(--border-muted);
  border-radius: 8px;
}

.stage-list strong,
.stage-list small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-list strong {
  color: var(--text);
  font-size: 12px;
}

.stage-list small {
  grid-column: 2;
  color: var(--text-muted);
  font-size: 11px;
}

.stage-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
}

.stage-dot--skip {
  background: var(--text-muted);
}

.results__columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.result-list {
  min-width: 0;
  border: 1px solid var(--border-muted);
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}

.result-list__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--border-muted);
  background: var(--surface-soft);
}

.result-list__head span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.result-list__head strong {
  color: var(--text-secondary);
  font-size: 12px;
}

.hit-list {
  margin: 0;
  padding: 6px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 280px;
  overflow-y: auto;
}

.hit-list button {
  width: 100%;
  min-height: 50px;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  text-align: left;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: inherit;
}

.hit-list button:hover {
  background: var(--primary-bg);
}

.hit-list li.is-active button {
  border-color: var(--primary-muted);
  background: var(--primary-bg);
}

.rank {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: #eef2f7;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.is-active .rank {
  background: var(--primary);
  color: #fff;
}

.hit-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.hit-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: 13px;
}

.hit-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 11px;
}

.muted {
  margin: 0;
  padding: 18px 12px;
  color: var(--text-muted);
  font-size: 12px;
}

.detail {
  border: 1px solid var(--border-muted);
  border-radius: 8px;
  padding: 12px;
  background: #fbfdff;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.detail h4 {
  font-size: 14px;
  margin-top: 1px;
}

.detail header span {
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--primary-bg);
  color: var(--primary);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.detail pre {
  margin: 0;
  font-size: 13px;
  color: var(--text);
  white-space: pre-wrap;
  max-height: 320px;
  overflow-y: auto;
  font-family: inherit;
  line-height: 1.7;
}

.empty-state {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
}

.empty-state svg {
  color: var(--primary);
}

.empty-state p {
  margin: 0;
  color: var(--text);
  font-weight: 700;
}

.empty-state span {
  font-size: 12px;
  color: var(--text-muted);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 920px) {
  .query-row,
  .results__columns,
  .params {
    grid-template-columns: 1fr;
  }

  .results__head {
    flex-direction: column;
  }

  .metrics {
    width: 100%;
    flex-wrap: wrap;
  }
}
</style>
