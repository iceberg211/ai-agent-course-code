<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[1000] flex bg-slate-900/30 backdrop-blur-sm"
      :class="side === 'left' ? 'justify-start' : 'justify-end'"
      @click.self="$emit('close')"
    >
      <aside
        class="side-drawer"
        :class="side === 'left' ? 'side-drawer--left' : 'side-drawer--right'"
        :style="{ width }"
        role="dialog"
        :aria-label="title"
      >
        <header class="side-drawer__head">
          <div class="side-drawer__titles">
            <h3>{{ title }}</h3>
            <p v-if="subtitle" :title="subtitle">{{ subtitle }}</p>
          </div>
          <button
            class="side-drawer__close"
            type="button"
            aria-label="关闭"
            @click="$emit('close')"
          >
            <XIcon :size="16" />
          </button>
        </header>
        <div class="side-drawer__body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="side-drawer__footer">
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

<style scoped>
.side-drawer {
  display: flex;
  flex-direction: column;
  max-width: 100%;
  height: 100%;
  background: #fff;
}

.side-drawer--right {
  box-shadow: -8px 0 32px rgba(15, 23, 42, 0.12);
}

.side-drawer--left {
  box-shadow: 8px 0 32px rgba(15, 23, 42, 0.12);
}

.side-drawer__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
  background: rgba(248, 250, 252, 0.7);
}

.side-drawer__titles {
  min-width: 0;
  text-align: left;
}

.side-drawer__titles h3 {
  margin: 0;
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
}

.side-drawer__titles p {
  margin: 4px 0 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.side-drawer__close {
  padding: 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.side-drawer__close:hover {
  background: #f1f5f9;
}

.side-drawer__body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

.side-drawer__footer {
  padding: 16px 24px;
  border-top: 1px solid var(--border);
  background: #fff;
}
</style>
