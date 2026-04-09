<template>
  <div class="typing" aria-label="AI 正在输入" role="status">
    <span /><span /><span />
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.typing { display: flex; gap: 5px; align-items: center; padding: 2px 0; }
.typing span {
  width: 8px; height: 8px;
  background: var(--primary-light);
  border-radius: 50%;
  animation: dot-bounce 1.1s infinite;
}
.typing span:nth-child(2) { animation-delay: 0.18s; }
.typing span:nth-child(3) { animation-delay: 0.36s; }

@keyframes dot-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30%           { transform: translateY(-5px); opacity: 1; }
}
</style>
