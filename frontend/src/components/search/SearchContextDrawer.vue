<template>
  <SideDrawer
    :open="open"
    title="原文档上下文"
    :subtitle="docName"
    width="580px"
    @close="$emit('close')"
  >
    <div v-if="loading" class="flex flex-col items-center justify-center p-16 text-center text-text-muted gap-3">
      <div class="w-7 h-7 border-3 border-blue-500/20 border-t-primary rounded-full animate-spin" />
      <p>加载上下文环境中…</p>
    </div>
    <div v-else class="flex flex-col gap-4">
      <div class="flex gap-4 bg-slate-100 p-3 rounded-lg">
        <label class="flex flex-col gap-1 text-[11px] text-text-secondary text-left font-bold">
          <span>往前加载段数</span>
          <input
            type="number"
            min="0"
            max="5"
            class="h-7.5 w-20 px-2 border border-border-main rounded bg-white text-xs outline-none focus:border-primary"
            :value="beforeChunks"
            @change="onBeforeChange"
          />
        </label>
        <label class="flex flex-col gap-1 text-[11px] text-text-secondary text-left font-bold">
          <span>往后加载段数</span>
          <input
            type="number"
            min="0"
            max="5"
            class="h-7.5 w-20 px-2 border border-border-main rounded bg-white text-xs outline-none focus:border-primary"
            :value="afterChunks"
            @change="onAfterChange"
          />
        </label>
      </div>

      <ul class="list-none p-0 m-0 flex flex-col gap-3">
        <li
          v-for="item in items"
          :key="item.id"
          class="border border-border-main rounded-lg p-3.5 bg-slate-50/50 text-left"
          :class="item.id === activeChunkId ? '!border-blue-600/40 !bg-blue-50/50' : ''"
        >
          <header class="flex justify-between mb-2 text-[11px] font-bold">
            <span class="text-text-muted">§ {{ item.chunkIndex + 1 }}</span>
            <span v-if="item.id === activeChunkId" class="bg-primary text-white text-[9.5px] px-1 py-0.25 rounded-[3px] font-bold">
              当前匹配段
            </span>
          </header>
          <pre class="text-xs leading-relaxed whitespace-pre-wrap text-text-secondary font-mono m-0">{{ item.content }}</pre>
        </li>
      </ul>
    </div>
  </SideDrawer>
</template>

<script setup lang="ts">
import SideDrawer from '@/components/common/SideDrawer.vue'

defineProps<{
  open: boolean
  docName: string
  loading: boolean
  beforeChunks: number
  afterChunks: number
  items: Array<{ id: string; chunkIndex: number; content: string }>
  activeChunkId?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:beforeChunks', value: number): void
  (e: 'update:afterChunks', value: number): void
  (e: 'reload'): void
}>()

function onBeforeChange(event: Event) {
  emit('update:beforeChunks', Number((event.target as HTMLInputElement).value))
  emit('reload')
}

function onAfterChange(event: Event) {
  emit('update:afterChunks', Number((event.target as HTMLInputElement).value))
  emit('reload')
}
</script>
