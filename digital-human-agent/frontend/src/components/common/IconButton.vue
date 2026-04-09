<template>
  <button
    class="icon-btn"
    :class="[variant, { active }]"
    :aria-label="label"
    :title="label"
    :disabled="disabled"
    v-bind="$attrs"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
defineProps({
  label:    { type: String, required: true },
  active:   { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  variant:  { type: String, default: 'default' }, // default | ghost | danger
})
</script>

<style scoped>
.icon-btn {
  width: 34px;
  height: 34px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out;
}
.icon-btn:hover { background: var(--primary-bg); border-color: var(--primary-muted); color: var(--primary); }
.icon-btn.active { background: var(--primary-bg); border-color: var(--primary); color: var(--primary); }
.icon-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.icon-btn.ghost { border-color: transparent; background: transparent; }
.icon-btn.ghost:hover { background: var(--primary-bg); border-color: transparent; }
.icon-btn.danger:hover { background: #FEE2E2; border-color: #FECACA; color: var(--error); }
</style>
