<template>
  <section class="flex-1 min-h-0 m-3 px-6 py-5.5 rounded-2xl border flex flex-col justify-center gap-4.5 shadow-sm text-left"
           :class="tone === 'warning' ? 'border-amber-500/20 bg-gradient-to-b from-amber-50/10 to-amber-500/5' : tone === 'success' ? 'border-blue-500/20 bg-gradient-to-b from-blue-50/10 to-blue-500/5' : 'border-slate-200/60 bg-gradient-to-b from-white to-slate-50/50'"
           aria-label="问答引导">
    <div class="w-13 h-13 rounded-2xl inline-flex items-center justify-center border shrink-0"
         :class="tone === 'warning' ? 'text-amber-600 bg-amber-50/90 border-amber-250/90 shadow-[0_10px_24px_rgba(217,119,6,0.08)]' : 'text-primary bg-blue-50/92 border-blue-200/90 shadow-[0_10px_24px_rgba(37,99,235,0.08)]'"
         aria-hidden="true">
      <component :is="iconComponent" :size="26" />
    </div>

    <div class="flex flex-col gap-2.5 max-w-[720px] text-left">
      <p class="m-0 text-[11px] font-bold tracking-wider uppercase text-text-muted">{{ eyebrow }}</p>
      <h2 class="m-0 text-xl md:text-2xl font-black text-text-main tracking-tight leading-tight">{{ title }}</h2>
      <p class="m-0 text-xs md:text-sm leading-relaxed text-text-secondary">{{ description }}</p>

      <ul v-if="steps.length" class="list-none grid grid-cols-1 md:grid-cols-3 gap-2.5 p-0 m-0 mt-1.5" role="list">
        <li v-for="(step, index) in steps" :key="`${index}-${step}`" class="flex items-center gap-2.5 min-h-11 p-2.5 px-3 rounded-xl bg-slate-50/90 border border-slate-200/80 text-xs font-medium text-text-secondary">
          <span class="w-5.5 h-5.5 rounded-full inline-flex items-center justify-center shrink-0 bg-primary-bg text-primary text-[11px] font-bold">{{ index + 1 }}</span>
          <span>{{ step }}</span>
        </li>
      </ul>

      <div v-if="capabilities.length" class="flex flex-wrap gap-2" aria-label="可用能力">
        <span
          v-for="capability in capabilities"
          :key="capability"
          class="inline-flex items-center min-h-7 px-2.5 rounded-full bg-blue-50/90 text-primary text-[11.5px] font-bold"
        >
          {{ capability }}
        </span>
      </div>

      <!-- 推荐引导问题 Prompt Starters -->
      <div v-if="suggestedQuestions.length" class="mt-3.5 flex flex-col gap-2">
        <span class="text-[10px] font-bold text-text-muted uppercase tracking-wider">推荐您问：</span>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="q in suggestedQuestions"
            :key="q"
            type="button"
            class="px-3.5 py-1.8 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-text-secondary cursor-pointer hover:bg-primary-bg hover:border-primary-muted hover:text-primary transition-all duration-200 shadow-[0_2px_8px_rgba(15,23,42,0.01)] hover:-translate-y-[0.5px]"
            @click="$emit('select-question', q)"
          >
            {{ q }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="primaryActionLabel || secondaryActionLabel"
      class="flex flex-wrap gap-2.5 mt-2"
    >
      <button
        v-if="primaryActionLabel"
        class="min-h-10 px-4 rounded-full border border-primary bg-primary text-white text-xs font-bold cursor-pointer transition-all hover:bg-primary-hover hover:border-primary-hover shadow-btn"
        type="button"
        @click="$emit('primary-action')"
      >
        {{ primaryActionLabel }}
      </button>
      <button
        v-if="secondaryActionLabel"
        class="min-h-10 px-4 rounded-full border border-border-main bg-white text-text-secondary text-xs font-bold cursor-pointer transition-all hover:bg-primary-bg hover:text-primary hover:border-primary-muted"
        type="button"
        @click="$emit('secondary-action')"
      >
        {{ secondaryActionLabel }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  BotIcon,
  BookOpenTextIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  eyebrow: string
  title: string
  description: string
  tone?: 'default' | 'warning' | 'success'
  steps?: string[]
  capabilities?: string[]
  primaryActionLabel?: string
  secondaryActionLabel?: string
  suggestedQuestions?: string[]
}>(), {
  tone: 'default',
  steps: () => [],
  capabilities: () => [],
  primaryActionLabel: '',
  secondaryActionLabel: '',
  suggestedQuestions: () => [],
})

defineEmits<{
  (e: 'primary-action'): void
  (e: 'secondary-action'): void
  (e: 'select-question', question: string): void
}>()

const iconComponent = computed(() => {
  if (props.tone === 'warning') return TriangleAlertIcon
  if (props.tone === 'success') return SparklesIcon
  if (props.steps.length > 0) return BookOpenTextIcon
  return BotIcon
})
</script>

<style scoped>
/* 本组件已全量改用 Tailwind CSS v4 原子类适配，无须 scoped CSS 样式 */
</style>
