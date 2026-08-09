<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="$emit('cancel')" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal">
        <div class="modal-header">
          <h2 id="modal-title" class="modal-title">新建角色</h2>
          <button class="close-btn" @click="$emit('cancel')" aria-label="关闭">
            <XIcon :size="16" />
          </button>
        </div>

        <form class="modal-body" @submit.prevent="onSubmit">
          <div class="field">
            <label class="label" for="create-name">角色名称 <span class="required">*</span></label>
            <input
              id="create-name"
              v-model="form.name"
              class="input"
              type="text"
              placeholder="例：李老师"
              maxlength="50"
              required
              autofocus
            />
          </div>

          <div class="field">
            <label class="label" for="create-desc">简介</label>
            <input
              id="create-desc"
              v-model="form.description"
              class="input"
              type="text"
              placeholder="例：资深前端讲师"
              maxlength="200"
            />
          </div>

          <div class="field">
            <label class="label" for="create-style">说话风格</label>
            <input
              id="create-style"
              v-model="form.speakingStyle"
              class="input"
              type="text"
              placeholder="例：说话温和，喜欢举例子"
              maxlength="200"
            />
          </div>

          <div class="field">
            <label class="label" for="create-expertise">擅长领域</label>
            <input
              id="create-expertise"
              v-model="form.expertiseRaw"
              class="input"
              type="text"
              placeholder="多个领域用逗号分隔，例：React, TypeScript"
              maxlength="200"
            />
            <p class="hint">用英文或中文逗号分隔</p>
          </div>

          <div class="field">
            <label class="label" for="create-prompt">系统提示补充</label>
            <textarea
              id="create-prompt"
              v-model="form.systemPromptExtra"
              class="input textarea"
              placeholder="例：回答尽量简洁，不超过 3 句话"
              maxlength="500"
              rows="3"
            />
          </div>

          <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

          <div class="modal-footer">
            <button type="button" class="btn-cancel" @click="$emit('cancel')">取消</button>
            <button type="submit" class="btn-submit" :disabled="submitting || !form.name.trim()">
              {{ submitting ? '创建中...' : '创建角色' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { XIcon } from 'lucide-vue-next'
import { usePersonaStore } from '@/stores/persona'
import type { Persona } from '@/types'

const emit = defineEmits<{
  (e: 'created', persona: Persona): void
  (e: 'cancel'): void
}>()

const personaStore = usePersonaStore()
const submitting = ref(false)
const errorMsg = ref('')

const form = reactive({
  name: '',
  description: '',
  speakingStyle: '',
  expertiseRaw: '',
  systemPromptExtra: '',
})

async function onSubmit() {
  if (!form.name.trim()) return
  submitting.value = true
  errorMsg.value = ''

  const expertise = form.expertiseRaw
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)

  const { ok, persona, message } = await personaStore.createPersona({
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    speakingStyle: form.speakingStyle.trim() || undefined,
    expertise: expertise.length ? expertise : undefined,
    systemPromptExtra: form.systemPromptExtra.trim() || undefined,
  })

  submitting.value = false

  if (!ok || !persona) {
    errorMsg.value = `创建失败：${message ?? '未知错误'}`
    return
  }

  emit('created', persona)
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fade-in 0.15s ease-out;
}

@keyframes fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.modal {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.18);
  width: 440px;
  max-width: calc(100vw - 32px);
  animation: slide-up 0.18s cubic-bezier(0.34, 1.26, 0.64, 1);
}

@keyframes slide-up {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border);
}

.modal-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}

.close-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: var(--bg-hover, #f0f0f5);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 150ms ease;
}
.close-btn:hover { background: var(--border); }

.modal-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.required { color: var(--error); }

.input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13.5px;
  color: var(--text);
  background: #fff;
  font-family: inherit;
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
.input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-bg);
}
.input::placeholder { color: var(--text-muted); }

.textarea {
  resize: vertical;
  min-height: 72px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.error-msg {
  font-size: 12px;
  color: var(--error);
  background: #fee2e2;
  padding: 7px 10px;
  border-radius: 7px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

.btn-cancel {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: background 150ms ease;
}
.btn-cancel:hover { background: var(--bg-hover, #f0f0f5); }

.btn-submit {
  padding: 8px 20px;
  border-radius: 8px;
  border: none;
  background: var(--primary);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: opacity 150ms ease, transform 100ms ease;
}
.btn-submit:hover:not(:disabled) { opacity: 0.88; }
.btn-submit:active:not(:disabled) { transform: scale(0.97); }
.btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
