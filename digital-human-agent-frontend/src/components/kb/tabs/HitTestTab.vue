<template>
  <div class="hit-test">
    <section class="controls">
      <div class="query-row">
        <input
          v-model="query"
          type="text"
          placeholder="输入你的问题，看看这个知识库召回什么…"
          :disabled="hook.searching.value"
          @keydown.enter="runSearch"
        />
        <button class="btn-primary" :disabled="!canSearch" @click="runSearch">
          <SearchIcon :size="14" />
          {{ hook.searching.value ? '检索中…' : '检索' }}
        </button>
      </div>

      <div class="params">
        <label>
          Threshold
          <input v-model.number="threshold" type="number" min="0" max="1" step="0.05" />
        </label>
        <label>
          stage1 topK
          <input v-model.number="stage1TopK" type="number" min="1" max="50" step="1" />
        </label>
        <label>
          finalTopK
          <input v-model.number="finalTopK" type="number" min="1" max="20" step="1" />
        </label>
        <label class="params__toggle">
          <input v-model="rerank" type="checkbox" />
          开启 Rerank
        </label>
        <button class="btn-ghost" type="button" @click="resetParams">恢复 KB 默认</button>
      </div>
    </section>

    <section v-if="result" class="results">
      <div class="results__head">
        <span>stage1 召回 {{ result.stage1.length }}</span>
        <span>stage2 {{ rerank ? 'rerank' : '截断' }} {{ result.stage2.length }}</span>
      </div>
      <div class="results__columns">
        <article class="column">
          <h4>Stage 1 · 向量召回</h4>
          <ol v-if="result.stage1.length">
            <li v-for="c in result.stage1" :key="`s1-${c.id}`" @click="selected = c" :class="{ 'is-active': selected?.id === c.id }">
              <div class="row-main">{{ c.source }} · § {{ c.chunk_index }}</div>
              <div class="row-sub">sim {{ fmt(c.similarity) }}</div>
            </li>
          </ol>
          <p v-else class="muted">无结果</p>
        </article>
        <article class="column">
          <h4>Stage 2 · Rerank</h4>
          <ol v-if="result.stage2.length">
            <li v-for="c in result.stage2" :key="`s2-${c.id}`" @click="selected = c" :class="{ 'is-active': selected?.id === c.id }">
              <div class="row-main">{{ c.source }} · § {{ c.chunk_index }}</div>
              <div class="row-sub">
                <span v-if="c.rerank_score != null">rerank {{ fmt(c.rerank_score) }} · </span>
                sim {{ fmt(c.similarity) }}
              </div>
            </li>
          </ol>
          <p v-else class="muted">无结果</p>
        </article>
      </div>

      <aside v-if="selected" class="detail">
        <header>命中内容</header>
        <pre>{{ selected.content }}</pre>
      </aside>
    </section>
    <p v-else class="muted hint">运行一次检索试试</p>
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
  const r = await hook.searchInKb(props.kb.id, query.value, {
    threshold: threshold.value,
    stage1TopK: stage1TopK.value,
    finalTopK: finalTopK.value,
    rerank: rerank.value,
  })
  result.value = r
}

function fmt(n: number | undefined): string {
  const v = Number(n)
  return Number.isFinite(v) ? v.toFixed(3) : '-'
}
</script>

<style scoped>
.hit-test { display: flex; flex-direction: column; gap: 16px; padding: 4px 0; }

.controls { display: flex; flex-direction: column; gap: 12px; }
.query-row { display: flex; gap: 8px; }
.query-row input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
}
.query-row input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.16); }
.btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 16px; background: var(--primary); color: #fff;
  border: none; border-radius: 8px; font-weight: 600; cursor: pointer;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost {
  background: transparent; color: var(--text-secondary);
  border: 1px solid var(--border); border-radius: 8px;
  padding: 4px 10px; font-size: 12px; cursor: pointer;
}
.btn-ghost:hover { background: var(--primary-bg); }

.params { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--text-secondary); align-items: center; }
.params label { display: flex; align-items: center; gap: 6px; }
.params input[type='number'] {
  width: 72px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
}
.params__toggle { cursor: pointer; }

.results__head { display: flex; gap: 16px; font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.results__columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.column { border: 1px solid var(--border); border-radius: 10px; padding: 12px; background: var(--surface); }
.column h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
.column ol { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.column li {
  padding: 6px 8px; border-radius: 6px; cursor: pointer;
  font-size: 12px; color: var(--text-secondary);
}
.column li:hover { background: var(--primary-bg); }
.column li.is-active { background: var(--primary-bg); color: var(--primary); font-weight: 600; }
.row-main { color: var(--text); font-size: 12px; }
.row-sub { font-size: 11px; color: var(--text-muted); }
.muted { color: var(--text-muted); font-size: 12px; }
.hint { padding: 24px; text-align: center; }

.detail {
  margin-top: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  background: var(--surface);
}
.detail header { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
.detail pre {
  margin: 0;
  font-size: 12px;
  color: var(--text);
  white-space: pre-wrap;
  max-height: 320px;
  overflow-y: auto;
  font-family: inherit;
  line-height: 1.5;
}
</style>
