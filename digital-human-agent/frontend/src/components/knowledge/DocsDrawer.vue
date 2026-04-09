<template>
  <aside class="docs-drawer" aria-label="知识库管理">
    <div class="drawer-header">
      <div class="title">
        <BookOpenIcon :size="15" color="var(--primary)" aria-hidden="true" />
        <span>知识库</span>
      </div>
      <button class="close-btn" @click="$emit('close')" aria-label="关闭知识库面板">
        <XIcon :size="15" aria-hidden="true" />
      </button>
    </div>

    <UploadZone :uploading="uploading" @upload="handleUpload" />

    <div class="list-header">
      <span>已上传文档</span>
      <span class="badge">{{ documents.length }}</span>
    </div>

    <ul class="doc-list" role="list" aria-label="文档列表">
      <DocItem
        v-for="doc in documents"
        :key="doc.id"
        :doc="doc"
        :status-label="statusLabel"
        @delete="handleDelete"
      />
      <li v-if="!documents.length" class="doc-empty" role="status">
        上传文档后可供 AI 检索引用
      </li>
    </ul>
  </aside>
</template>

<script setup>
import { BookOpenIcon, XIcon } from 'lucide-vue-next'
import UploadZone from './UploadZone.vue'
import DocItem from './DocItem.vue'

const props = defineProps({
  personaId: { type: String, default: '' },
  documents: { type: Array,  default: () => [] },
  uploading: { type: Boolean, default: false },
  statusLabel: { type: Function, required: true },
})
const emit = defineEmits(['close', 'upload', 'delete'])

function handleUpload(file) { emit('upload', file) }
function handleDelete(docId) { emit('delete', docId) }
</script>

<style scoped>
.docs-drawer {
  width: 292px; flex-shrink: 0;
  background: var(--surface); border-left: 1px solid var(--border);
  display: flex; flex-direction: column; overflow: hidden;
}
.drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--border);
}
.title { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 600; color: var(--text); }
.close-btn {
  width: 28px; height: 28px; border-radius: 6px; border: none; background: none;
  color: var(--text-muted); display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 150ms ease-out;
}
.close-btn:hover { background: var(--primary-bg); color: var(--text); }
.list-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px 6px; font-size: 10px; font-weight: 700;
  color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em;
}
.badge { background: var(--border-muted); color: var(--text-secondary); border-radius: 10px; padding: 1px 7px; font-size: 11px; }
.doc-list { flex: 1; overflow-y: auto; padding: 2px 8px 12px; list-style: none; }
.doc-empty { text-align: center; color: var(--text-muted); font-size: 12px; padding: 20px; list-style: none; }
</style>
