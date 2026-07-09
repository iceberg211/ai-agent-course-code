<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[1000] flex bg-slate-900/30 backdrop-blur-sm"
      :class="side === 'left' ? 'justify-start' : 'justify-end'"
      @click.self="$emit('close')"
    >
      <aside
        class="h-full bg-white flex flex-col shadow-[-8px_0_32px_rgba(15,23,42,0.12)] max-w-full"
        :class="side === 'left' ? 'shadow-[8px_0_32px_rgba(15,23,42,0.12)]' : ''"
        :style="{ width }"
        role="dialog"
        :aria-label="title"
      >
        <header class="p-5 px-6 border-b border-border-main flex items-start justify-between gap-4 bg-slate-50/50">
          <div class="min-w-0 text-left">
            <h3 class="m-0 text-sm font-bold text-text-main">{{ title }}</h3>
            <p v-if="subtitle" class="m-0 mt-1 text-xs text-text-muted truncate" :title="subtitle">
              {{ subtitle }}
            </p>
          </div>
          <button
            class="bg-transparent border-none text-text-muted cursor-pointer p-1 rounded-md hover:bg-slate-100"
            type="button"
            aria-label="关闭"
            @click="$emit('close')"
          >
            <XIcon :size="16" />
          </button>
        </header>
        <div class="flex-1 overflow-y-auto p-5 px-6">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="p-4 px-6 border-t border-border-main bg-white">
          <slot name="footer" />
        </footer>
      </aside>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { XIcon } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    open: boolean
    title: string
    subtitle?: string
    width?: string
    side?: 'left' | 'right'
  }>(),
  {
    subtitle: '',
    width: '520px',
    side: 'right',
  },
)

defineEmits<{
  (e: 'close'): void
}>()
</script>
