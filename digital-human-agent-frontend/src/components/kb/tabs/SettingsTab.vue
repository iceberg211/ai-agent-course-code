<template>
  <div class="settings-tab">
    <section class="settings-hero">
      <div>
        <p class="eyebrow">配置</p>
        <h3>调整知识库的召回行为</h3>
        <p>这些参数会影响命中测试和角色对话中的知识检索结果。</p>
      </div>
      <div class="status-pill" :class="{ 'status-pill--dirty': dirty }">
        {{ dirty ? '有未保存修改' : '已保存' }}
      </div>
    </section>

    <div class="settings-layout">
      <section class="block">
        <div class="block__head">
          <div>
            <p class="eyebrow">基础信息</p>
            <h4>知识库档案</h4>
          </div>
        </div>
        <label class="field">
          <span>名称</span>
          <input v-model="draft.name" type="text" maxlength="120" />
        </label>
        <label class="field">
          <span>描述</span>
          <textarea v-model="draft.description" rows="4" maxlength="500" placeholder="说明这个知识库适合回答哪些问题" />
        </label>

        <div class="actions">
          <button class="btn-ghost" :disabled="!dirty || saving" @click="reset">恢复</button>
          <button class="btn-primary" :disabled="!dirty || saving" @click="save">
            {{ saving ? '保存中' : '保存配置' }}
          </button>
        </div>
        <p v-if="saveError" class="error" role="alert">{{ saveError }}</p>
      </section>

      <section class="block block--retrieval">
        <div class="block__head">
          <div>
            <p class="eyebrow">检索参数</p>
            <h4>召回与重排</h4>
          </div>
          <label class="switch">
            <input v-model="draft.retrievalConfig.rerank" type="checkbox" />
            <span>Rerank</span>
          </label>
        </div>

        <label class="range-field">
          <span>
            <strong>相似度阈值</strong>
            <small>低阈值会召回更多片段，高阈值更严格。</small>
          </span>
          <b>{{ draft.retrievalConfig.threshold.toFixed(2) }}</b>
          <input v-model.number="draft.retrievalConfig.threshold" type="range" min="0" max="1" step="0.05" />
        </label>

        <div class="number-grid">
          <label class="field">
            <span>候选片段数</span>
            <input v-model.number="draft.retrievalConfig.stage1TopK" type="number" min="1" max="50" />
            <small>向量召回进入重排前的候选数量。</small>
          </label>
          <label class="field">
            <span>最终片段数</span>
            <input v-model.number="draft.retrievalConfig.finalTopK" type="number" min="1" max="20" />
            <small>最终注入对话上下文的片段数量。</small>
          </label>
        </div>
      </section>
    </div>

    <section class="danger">
      <div>
        <p class="eyebrow">危险区</p>
        <h4>删除知识库</h4>
        <p class="danger__hint">会级联移除所有文档与 chunks，已挂载的角色也会失去这部分知识。</p>
      </div>
      <button class="btn-danger" :disabled="deleting" @click="onDelete">
        {{ deleting ? '删除中' : '删除此知识库' }}
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useKnowledgeBase } from '../../../hooks/useKnowledgeBase'
import type { KnowledgeBase } from '../../../types'

const props = defineProps<{ kb: KnowledgeBase }>()
const emit = defineEmits<{
  (e: 'changed', kb: KnowledgeBase): void
  (e: 'deleted'): void
}>()

const hook = useKnowledgeBase()
const saving = ref(false)
const deleting = ref(false)
const saveError = ref('')

const draft = reactive({
  name: props.kb.name,
  description: props.kb.description ?? '',
  retrievalConfig: { ...props.kb.retrievalConfig },
})

function snapshot() {
  return JSON.stringify({
    name: props.kb.name,
    description: props.kb.description ?? '',
    retrievalConfig: props.kb.retrievalConfig,
  })
}

const dirty = computed(() => {
  const orig = snapshot()
  const cur = JSON.stringify({
    name: draft.name,
    description: draft.description,
    retrievalConfig: draft.retrievalConfig,
  })
  return orig !== cur
})

watch(
  () => props.kb.id,
  () => reset(),
)

function reset() {
  draft.name = props.kb.name
  draft.description = props.kb.description ?? ''
  draft.retrievalConfig = { ...props.kb.retrievalConfig }
  saveError.value = ''
}

async function save() {
  saving.value = true
  saveError.value = ''
  try {
    const updated = await hook.update(props.kb.id, {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      retrievalConfig: { ...draft.retrievalConfig },
    })
    if (!updated) {
      saveError.value = '保存失败，请稍后重试'
      return
    }
    emit('changed', updated)
  } finally {
    saving.value = false
  }
}

async function onDelete() {
  if (!confirm(`确定删除知识库「${props.kb.name}」？此操作不可恢复。`)) return
  deleting.value = true
  try {
    const ok = await hook.remove(props.kb.id)
    if (ok) emit('deleted')
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
.settings-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 20px;
}

.settings-hero,
.block,
.danger {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.settings-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
}

.eyebrow {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.settings-hero h3,
.block h4,
.danger h4 {
  margin: 1px 0 0;
  color: var(--text);
  font-weight: 700;
  letter-spacing: 0;
}

.settings-hero h3 { font-size: 17px; }
.block h4,
.danger h4 { font-size: 15px; }

.settings-hero p:not(.eyebrow),
.danger__hint {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.status-pill {
  padding: 5px 10px;
  border-radius: 999px;
  background: #ecfdf5;
  color: var(--success);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.status-pill--dirty {
  background: #fff7ed;
  color: var(--warning);
}

.settings-layout {
  display: grid;
  grid-template-columns: minmax(280px, 0.88fr) minmax(340px, 1.12fr);
  gap: 16px;
  align-items: start;
}

.block {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.block__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-muted);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.field span,
.range-field strong {
  color: var(--text-secondary);
  font-weight: 700;
}

.field input[type='text'], .field textarea, .field input[type='number'] {
  width: 100%;
  min-height: 40px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: #fff;
}

.field textarea {
  resize: vertical;
  min-height: 108px;
}

.field input:focus,
.field textarea:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.13);
}

.field small,
.range-field small {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.switch {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-soft);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.switch input,
.range-field input {
  accent-color: var(--primary);
}

.range-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 52px;
  gap: 8px 14px;
  align-items: center;
}

.range-field span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.range-field b {
  justify-self: end;
  color: var(--primary);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.range-field input {
  grid-column: 1 / -1;
  width: 100%;
}

.number-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 2px;
}

.btn-primary,
.btn-ghost,
.btn-danger {
  min-height: 40px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
}
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--primary-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost { background: transparent; color: var(--text-secondary); border-color: var(--border); }
.btn-ghost:hover:not(:disabled) { background: var(--primary-bg); color: var(--primary); }
.btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-danger { background: var(--error); color: #fff; }
.btn-danger:hover:not(:disabled) { filter: brightness(1.06); }
.btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
.error { margin: 0; color: var(--error); font-size: 12px; }

.danger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 18px;
  background: #fff7f7;
  border-color: #fecaca;
}

.danger h4 {
  color: var(--error);
}

@media (max-width: 920px) {
  .settings-hero,
  .danger {
    flex-direction: column;
    align-items: stretch;
  }

  .settings-layout,
  .number-grid {
    grid-template-columns: 1fr;
  }
}
</style>
