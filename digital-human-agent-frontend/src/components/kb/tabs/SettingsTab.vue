<template>
  <div class="settings-tab">
    <section class="block">
      <h4>基础信息</h4>
      <label class="field">
        <span>名称</span>
        <input v-model="draft.name" type="text" maxlength="120" />
      </label>
      <label class="field">
        <span>描述</span>
        <textarea v-model="draft.description" rows="3" maxlength="500" />
      </label>
    </section>

    <section class="block">
      <h4>检索参数</h4>
      <div class="params-grid">
        <label class="field">
          <span>Threshold ({{ draft.retrievalConfig.threshold.toFixed(2) }})</span>
          <input v-model.number="draft.retrievalConfig.threshold" type="range" min="0" max="1" step="0.05" />
        </label>
        <label class="field">
          <span>stage1 topK</span>
          <input v-model.number="draft.retrievalConfig.stage1TopK" type="number" min="1" max="50" />
        </label>
        <label class="field">
          <span>finalTopK</span>
          <input v-model.number="draft.retrievalConfig.finalTopK" type="number" min="1" max="20" />
        </label>
        <label class="field field--inline">
          <input v-model="draft.retrievalConfig.rerank" type="checkbox" />
          <span>开启 Rerank</span>
        </label>
      </div>
    </section>

    <div class="actions">
      <button class="btn-ghost" :disabled="!dirty || saving" @click="reset">恢复</button>
      <button class="btn-primary" :disabled="!dirty || saving" @click="save">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </div>
    <p v-if="saveError" class="error">{{ saveError }}</p>

    <section class="danger">
      <h4>危险区</h4>
      <p class="danger__hint">删除知识库会级联移除所有文档与 chunks，无法恢复。</p>
      <button class="btn-danger" :disabled="deleting" @click="onDelete">
        {{ deleting ? '删除中…' : '删除此知识库' }}
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
.settings-tab { display: flex; flex-direction: column; gap: 20px; max-width: 640px; }

.block { border: 1px solid var(--border); border-radius: 10px; padding: 16px; background: var(--surface); display: flex; flex-direction: column; gap: 12px; }
.block h4 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }

.field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.field--inline { flex-direction: row; align-items: center; }
.field input[type='text'], .field textarea, .field input[type='number'] {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: #fff;
}
.field input[type='range'] { accent-color: var(--primary); }

.params-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.actions { display: flex; gap: 8px; justify-content: flex-end; }
.btn-primary, .btn-ghost, .btn-danger {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost { background: transparent; color: var(--text-secondary); border-color: var(--border); }
.btn-ghost:hover { background: var(--primary-bg); }
.btn-danger { background: var(--error); color: #fff; }
.btn-danger:hover { filter: brightness(1.08); }
.error { margin: 0; color: var(--error); font-size: 12px; }

.danger { border: 1px solid var(--error); border-radius: 10px; padding: 16px; background: #fef2f2; }
.danger h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; color: var(--error); }
.danger__hint { margin: 0 0 12px; font-size: 12px; color: var(--text-secondary); }
</style>
