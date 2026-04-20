<template>
  <div class="modal-backdrop" @click.self="$emit('cancel')">
    <div class="modal" role="dialog" aria-label="新建知识库">
      <h3 class="modal__title">新建知识库</h3>

      <label class="field">
        <span>名称</span>
        <input v-model="name" type="text" placeholder="例如：产品 FAQ" maxlength="120" autofocus />
      </label>

      <label class="field">
        <span>描述（可选）</span>
        <textarea v-model="description" rows="3" maxlength="500" placeholder="这个知识库收录什么内容？" />
      </label>

      <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

      <div class="actions">
        <button type="button" class="btn btn--ghost" @click="$emit('cancel')">取消</button>
        <button type="button" class="btn btn--primary" :disabled="!canSubmit || submitting" @click="onSubmit">
          {{ submitting ? '创建中…' : '创建' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'submit', payload: { name: string; description?: string }): void
}>()

defineProps<{ submitting?: boolean; errorMsg?: string }>()

const name = ref('')
const description = ref('')

const canSubmit = computed(() => name.value.trim().length > 0)

function onSubmit() {
  if (!canSubmit.value) return
  emit('submit', {
    name: name.value.trim(),
    description: description.value.trim() || undefined,
  })
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  width: min(480px, 92vw);
  background: var(--surface);
  border-radius: 16px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.24);
}
.modal__title { margin: 0; font-size: 16px; font-weight: 600; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.field input, .field textarea {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  color: var(--text);
  background: #fff;
  font: inherit;
}
.field input:focus, .field textarea:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.16);
}
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
.btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn--ghost { background: transparent; color: var(--text-secondary); border-color: var(--border); }
.btn--ghost:hover { background: var(--primary-bg); }
.btn--primary { background: var(--primary); color: #fff; }
.btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.error { margin: 0; color: var(--error); font-size: 12px; }
</style>
