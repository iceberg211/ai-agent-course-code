<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[1000] flex items-center justify-center"
      @click.self="$emit('close')"
    >
      <div class="bg-white rounded-xl shadow-[0_20px_25px_-5px_rgba(15,23,42,0.1)] w-[500px] max-w-full overflow-hidden flex flex-col border border-border-main">
        <header class="p-5 border-b border-border-main flex items-center justify-between bg-slate-50/50">
          <h3 class="m-0 text-sm font-bold text-text-main">添加黄金测试用例</h3>
          <button class="bg-transparent border-none text-text-muted cursor-pointer" type="button" @click="$emit('close')">
            <XIcon :size="16" />
          </button>
        </header>
        <form class="p-5 flex flex-col gap-4 text-left" @submit.prevent="submit">
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-text-secondary">黄金测试提问 <span class="text-error">*</span></label>
            <textarea
              v-model="local.question"
              class="w-full p-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary"
              rows="3"
              placeholder="输入用户真实可能提问的典型 query…"
              required
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-text-secondary">标准黄金答案 / 评测依据文段</label>
            <textarea
              v-model="local.expectedAnswer"
              class="w-full p-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary"
              rows="4"
              placeholder="大模型作答评测将以本段作为真值（Ground Truth）参考…"
            />
          </div>
          <footer class="flex justify-end gap-3">
            <button class="h-9 px-4 border border-border-main bg-white rounded-lg text-xs font-semibold text-text-secondary cursor-pointer hover:bg-slate-50" type="button" @click="$emit('close')">
              取消
            </button>
            <button
              class="h-9 px-5 bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white border-none rounded-lg text-xs font-bold cursor-pointer hover:brightness-104 disabled:opacity-50"
              type="submit"
              :disabled="submitting"
            >
              添加
            </button>
          </footer>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'
import { XIcon } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  question?: string
  expectedAnswer?: string
  submitting: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', payload: { question: string; expectedAnswer: string }): void
}>()

const local = reactive({
  question: '',
  expectedAnswer: '',
})

watch(
  () => [props.open, props.question, props.expectedAnswer] as const,
  ([open]) => {
    if (open) {
      local.question = props.question || ''
      local.expectedAnswer = props.expectedAnswer || ''
    }
  },
  { immediate: true },
)

function submit() {
  if (!local.question.trim()) return
  emit('submit', {
    question: local.question.trim(),
    expectedAnswer: local.expectedAnswer,
  })
}
</script>
