<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      @click.self="$emit('close')"
    >
      <div class="w-full max-w-5xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-border-main shadow-2xl p-5 flex flex-col gap-4">
        <header class="flex items-center justify-between gap-3">
          <div>
            <h3 class="m-0 text-sm font-bold text-text-main">检索策略 Sandbox 对比</h3>
            <p class="m-0 mt-1 text-xs text-text-muted">并行对比向量、图谱混合与 Rerank 策略结果。</p>
          </div>
          <button class="w-6 h-6 border-none bg-transparent rounded-full flex items-center justify-center cursor-pointer text-text-muted hover:bg-slate-100" type="button" @click="$emit('close')">
            <XIcon :size="16" />
          </button>
        </header>

        <form class="flex gap-2" @submit.prevent="$emit('compare')">
          <input
            :value="query"
            type="text"
            class="flex-1 h-10 px-3 border border-border-main rounded-xl text-xs outline-none focus:border-primary"
            placeholder="输入对比问题"
            @input="$emit('update:query', ($event.target as HTMLInputElement).value)"
          />
          <button
            class="px-5 h-10 bg-primary text-white border-none rounded-xl text-xs font-bold cursor-pointer hover:brightness-105 inline-flex items-center gap-1.5 disabled:opacity-60"
            type="submit"
            :disabled="comparing || !query.trim()"
          >
            <RefreshCwIcon :size="13" :class="{ 'animate-spin': comparing }" />
            <span>{{ comparing ? '并行检索中…' : '执行策略比对' }}</span>
          </button>
        </form>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SandboxColumn title="A · 向量/关键词" :loading="comparing" :result="resultA" />
          <SandboxColumn title="B · 混合+图谱" :loading="comparing" :result="resultB" />
          <SandboxColumn title="C · 混合+Rerank" :loading="comparing" :result="resultC" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { RefreshCwIcon, XIcon } from 'lucide-vue-next'
import SandboxColumn from '@/components/evaluation/SandboxColumn.vue'

defineProps<{
  open: boolean
  query: string
  comparing: boolean
  resultA: any
  resultB: any
  resultC: any
}>()

defineEmits<{
  (e: 'close'): void
  (e: 'compare'): void
  (e: 'update:query', value: string): void
}>()
</script>
