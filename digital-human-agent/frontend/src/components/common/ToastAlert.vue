<template>
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="message" class="toast" role="alert" aria-live="assertive">
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
  background: var(--text);
  color: #fff;
  padding: 9px 18px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(124,58,237,0.1);
}
.toast-enter-active { transition: all 200ms ease-out; }
.toast-leave-active { transition: all 180ms ease-in; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
