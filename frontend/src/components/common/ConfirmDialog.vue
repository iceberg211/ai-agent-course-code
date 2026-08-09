<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      @click.self="$emit('cancel')"
    >
      <div class="w-full max-w-md bg-white rounded-xl border border-border-main shadow-[0_20px_50px_rgba(15,23,42,0.16)] p-5 flex flex-col gap-4 text-left">
        <div>
          <h3 class="m-0 text-sm font-bold text-text-main">{{ title }}</h3>
          <p v-if="description" class="m-0 mt-2 text-xs text-text-muted leading-relaxed">
            {{ description }}
          </p>
        </div>
        <div class="flex justify-end gap-2">
          <button
            class="px-3.5 py-2 border border-border-main bg-white rounded-lg text-xs font-bold text-text-secondary cursor-pointer hover:bg-slate-50"
            type="button"
            :disabled="loading"
            @click="$emit('cancel')"
          >
            {{ cancelLabel }}
          </button>
          <button
            class="px-3.5 py-2 border-none rounded-lg text-xs font-bold text-white cursor-pointer disabled:opacity-60"
            :class="danger ? 'bg-red-600 hover:brightness-105' : 'bg-primary hover:brightness-105'"
            type="button"
            :disabled="loading"
            @click="$emit('confirm')"
          >
            {{ loading ? loadingLabel : confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    loadingLabel?: string
    loading?: boolean
    danger?: boolean
  }>(),
  {
    description: '',
    confirmLabel: '确认',
    cancelLabel: '取消',
    loadingLabel: '处理中…',
    loading: false,
    danger: false,
  },
)

defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()
</script>
