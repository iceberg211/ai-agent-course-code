<template>
  <li class="doc-item" role="listitem">
    <FileTextIcon :size="15" color="var(--text-muted)" aria-hidden="true" class="file-icon" />
    <div class="details">
      <span class="name" :title="doc.filename">{{ doc.filename }}</span>
      <div class="meta">
        <span class="status-badge" :class="doc.status">{{ statusLabel(doc.status) }}</span>
        <span v-if="doc.chunkCount > 0" class="chunks">{{ doc.chunkCount }} 段</span>
      </div>
    </div>
    <button class="del-btn" @click="$emit('delete', doc.id)" :aria-label="`删除 ${doc.filename}`">
      <Trash2Icon :size="13" aria-hidden="true" />
    </button>
  </li>
</template>

<script setup lang="ts">
import { FileTextIcon, Trash2Icon } from 'lucide-vue-next'
defineProps({ doc: { type: Object, required: true }, statusLabel: { type: Function, required: true } })
defineEmits(['delete'])
</script>

<style scoped>
.doc-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 8px; border-radius: 6px;
  list-style: none; transition: background-color 150ms ease-out;
}
.doc-item:hover { background: var(--primary-bg); }
.file-icon { flex-shrink: 0; }
.details { flex: 1; overflow: hidden; }
.name { font-size: 13px; font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
.meta { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
.status-badge { font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 10px; }
.status-badge.completed  { background: #DCFCE7; color: #15803D; }
.status-badge.processing { background: #FEF3C7; color: #B45309; }
.status-badge.pending    { background: #F3F4F6; color: #6B7280; }
.status-badge.failed     { background: #FEE2E2; color: #B91C1C; }
.chunks { font-size: 11px; color: var(--text-muted); }
.del-btn {
  width: 26px; height: 26px; border-radius: 6px; border: none; background: none;
  color: var(--text-muted); display: flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: 0; flex-shrink: 0;
  transition: opacity 150ms ease-out, background-color 150ms ease-out, color 150ms ease-out;
}
.doc-item:hover .del-btn { opacity: 1; }
.del-btn:hover { background: #FEE2E2; color: var(--error); }
</style>
