<template>
  <section class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-6 shadow-[0_4px_20px_rgba(15,23,42,0.02)] flex flex-col gap-5">
    <div>
      <h4 class="text-[14.5px] font-bold text-text-main m-0">AI 长期记忆管理 (mem0)</h4>
      <p class="text-xs text-text-muted mt-1 m-0">系统会在对话中自动提取个人偏好和业务习惯；也可在此手动管理。</p>
    </div>

    <form class="grid grid-cols-[1fr_auto] gap-2.5" @submit.prevent="onCreate">
      <input
        v-model="content"
        type="text"
        class="w-full h-10 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary"
        placeholder="输入需要让 AI 记住的事实"
        :disabled="loading"
      />
      <button
        class="inline-flex items-center justify-center gap-1.5 h-10 px-4 bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white border-none rounded-lg text-xs font-bold cursor-pointer disabled:opacity-60"
        type="submit"
        :disabled="loading || !content.trim()"
      >
        <BrainIcon :size="14" />
        记住事实
      </button>
    </form>

    <div class="flex flex-col gap-3 border-t border-slate-200/50 pt-4">
      <div class="flex justify-between items-center gap-2">
        <span class="text-xs font-bold text-text-secondary">已保存的记忆列表</span>
        <input
          :value="searchQuery"
          type="text"
          class="w-48 h-8 px-2 border border-border-main rounded-md bg-white text-text-main outline-none text-[11px] focus:border-primary"
          placeholder="搜索记忆…"
          @input="onSearch"
        />
      </div>
      <div class="flex flex-col gap-2 max-h-60 overflow-y-auto">
        <article
          v-for="item in memories"
          :key="item.id"
          class="flex items-center justify-between gap-3 p-3 border border-border-main rounded-lg bg-white/40"
        >
          <div class="flex flex-col gap-1 text-left min-w-0 flex-1">
            <p class="text-xs font-bold text-text-secondary leading-relaxed break-words m-0">{{ item.content }}</p>
            <span class="text-[10px] text-text-muted">
              安全：{{ item.visibility }} · 类别：{{ item.category }} · {{ formatDate(item.createdAt || item.created_at) }}
            </span>
          </div>
          <button
            class="h-7.5 px-3 border border-red-500/18 rounded-[7px] bg-red-500/6 text-error text-[11.5px] font-bold cursor-pointer disabled:opacity-50"
            type="button"
            :disabled="loading"
            @click="$emit('delete', item.id)"
          >
            抹除
          </button>
        </article>
        <p v-if="!memories.length" class="text-xs text-text-muted m-0 py-3">暂无记忆。</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { BrainIcon } from 'lucide-vue-next'

defineProps<{
  memories: Array<Record<string, any>>
  loading: boolean
  searchQuery: string
}>()

const emit = defineEmits<{
  (e: 'create', content: string): void
  (e: 'delete', id: string): void
  (e: 'search', query: string): void
}>()

const content = ref('')

function onCreate() {
  const value = content.value.trim()
  if (!value) return
  emit('create', value)
  content.value = ''
}

function onSearch(event: Event) {
  emit('search', (event.target as HTMLInputElement).value)
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '-'
}
</script>
