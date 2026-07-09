<template>
  <section class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-6 shadow-[0_4px_20px_rgba(15,23,42,0.02)] flex flex-col gap-5">
    <div>
      <h4 class="text-[14.5px] font-bold text-text-main m-0">API Key 管理</h4>
      <p class="text-xs text-text-muted mt-1 m-0">用于脚本、服务端任务或内部系统调用知识库与问答接口。</p>
    </div>

    <form class="grid grid-cols-[1fr_auto] gap-2.5" @submit.prevent="onCreate">
      <input
        v-model="name"
        type="text"
        class="w-full h-10 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary"
        placeholder="输入用途名称，例如 数据同步任务"
        :disabled="loading"
      />
      <button
        class="inline-flex items-center justify-center gap-1.5 h-10 px-4 bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white border-none rounded-lg text-xs font-bold cursor-pointer disabled:opacity-60"
        type="submit"
        :disabled="loading || !name.trim()"
      >
        <KeyRoundIcon :size="14" />
        创建 Key
      </button>
    </form>

    <div v-if="createdPlainKey" class="flex items-center justify-between gap-3 p-3 border border-blue-500/20 rounded-lg bg-blue-50">
      <div class="flex flex-col gap-1 text-left min-w-0">
        <span class="text-xs font-bold text-text-secondary">新 API Key 仅展示一次</span>
        <code class="max-w-full overflow-auto whitespace-nowrap font-mono text-xs text-primary">{{ createdPlainKey }}</code>
      </div>
      <button class="bg-transparent border border-border-main rounded-md px-2.5 py-1 text-[11px] font-bold text-text-secondary cursor-pointer hover:text-primary" type="button" @click="$emit('copy', createdPlainKey)">
        复制
      </button>
    </div>

    <div class="flex flex-col gap-2.5">
      <article
        v-for="item in apiKeys"
        :key="item.id"
        class="flex items-center justify-between gap-3 p-3 border border-border-main rounded-lg bg-white"
      >
        <div class="flex flex-col gap-1 text-left">
          <strong class="text-xs font-bold text-text-secondary">{{ item.name }}</strong>
          <span class="text-xs text-text-muted">{{ item.keyPrefix }}••••{{ item.keyLastFour }} · {{ formatDate(item.createdAt) }}</span>
        </div>
        <button
          class="h-7.5 px-3 border border-red-500/18 rounded-[7px] bg-red-500/6 text-error text-[11.5px] font-bold cursor-pointer disabled:opacity-50"
          type="button"
          :disabled="loading || !item.isActive"
          @click="$emit('revoke', item.id)"
        >
          {{ item.isActive ? '废弃' : '已废弃' }}
        </button>
      </article>
      <p v-if="!apiKeys.length" class="text-xs text-text-muted m-0">暂无 API Key。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { KeyRoundIcon } from 'lucide-vue-next'
import type { ApiKeyItem } from '@/types'

const props = defineProps<{
  apiKeys: ApiKeyItem[]
  loading: boolean
  createdPlainKey: string
}>()

const emit = defineEmits<{
  (e: 'create', name: string): void
  (e: 'revoke', id: string): void
  (e: 'copy', value: string): void
}>()

const name = ref('')

watch(
  () => props.createdPlainKey,
  (value) => {
    if (value) name.value = ''
  },
)

function onCreate() {
  const value = name.value.trim()
  if (!value) return
  emit('create', value)
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '-'
}
</script>
