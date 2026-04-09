<template>
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="message" class="toast" role="status" aria-live="polite">
        {{ message }}
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
defineProps({
  message: { type: String, default: '' },
})
</script>

<style scoped>
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--text-secondary);
  color: #fff;
  padding: 9px 18px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  z-index: 1000;
  box-shadow: var(--shadow-sm);
}
.toast-enter-active { transition: opacity 200ms ease-out, transform 200ms ease-out; }
.toast-leave-active { transition: opacity 180ms ease-in, transform 180ms ease-in; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
