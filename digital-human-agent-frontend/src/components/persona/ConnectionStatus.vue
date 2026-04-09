<template>
  <div class="conn" :class="{ online: connected }" role="status" :aria-label="connected ? '已连接' : '连接中'">
    <span class="dot" aria-hidden="true" />
    <span>{{ connected ? '已连接' : '连接中...' }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps({ connected: { type: Boolean, default: false } })
</script>

<style scoped>
.conn { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 500; color: var(--text-muted); }
.conn.online { color: var(--success); }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); flex-shrink: 0; }
.conn.online .dot { background: var(--success); }
</style>
