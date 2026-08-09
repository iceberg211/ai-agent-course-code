<template>
  <aside class="flex flex-col gap-3 text-left">
    <header v-if="title" class="flex items-center gap-1.5 text-xs font-bold text-primary">
      <ShieldIcon :size="14" />
      <span>{{ title }}</span>
    </header>

    <div v-if="summary.length" class="grid grid-cols-2 gap-2">
      <div
        v-for="item in summary"
        :key="item.label"
        class="bg-white border border-slate-200/60 rounded-lg p-2.5"
      >
        <span class="block text-[10px] font-bold text-text-muted">{{ item.label }}</span>
        <strong class="block mt-1 text-base font-black text-text-main">{{ item.value }}</strong>
      </div>
    </div>

    <section
      v-for="block in blocks"
      :key="block.key"
      class="bg-white border border-slate-200/60 rounded-lg p-3"
      :class="block.tone === 'warn' ? 'border-amber-200 bg-amber-50' : block.tone === 'danger' ? 'border-red-200 bg-red-50/50' : ''"
    >
      <h5 class="m-0 mb-2 text-xs font-bold text-text-main">{{ block.title }}</h5>
      <div class="text-[11.5px] text-text-secondary flex flex-col gap-1.5">
        <div
          v-for="row in block.rows"
          :key="row.label"
          class="flex justify-between items-start gap-2"
        >
          <span class="min-w-0">{{ row.label }}</span>
          <strong class="shrink-0 text-text-main font-semibold text-right">{{ row.value }}</strong>
        </div>
        <p v-if="block.description" class="m-0 text-[10.5px] text-text-muted leading-relaxed">
          {{ block.description }}
        </p>
        <ul v-if="block.list?.length" class="list-none m-0 p-0 flex flex-col gap-1">
          <li v-for="(item, idx) in block.list" :key="`${block.key}-${idx}`" class="leading-relaxed">
            {{ item }}
          </li>
        </ul>
      </div>
    </section>

    <slot />
  </aside>
</template>

<script setup lang="ts">
import { ShieldIcon } from 'lucide-vue-next'

export interface TraceSummaryItem {
  label: string
  value: string | number
}

export interface TraceBlockRow {
  label: string
  value: string | number
}

export interface TraceBlock {
  key: string
  title: string
  rows?: TraceBlockRow[]
  list?: string[]
  description?: string
  tone?: 'default' | 'warn' | 'danger'
}

withDefaults(
  defineProps<{
    title?: string
    summary?: TraceSummaryItem[]
    blocks?: TraceBlock[]
  }>(),
  {
    title: '检索链路 Trace',
    summary: () => [],
    blocks: () => [],
  },
)
</script>
