<template>
  <label
    class="upload-zone"
    :class="{ dragover: isDragover, uploading }"
    @dragover.prevent="isDragover = true"
    @dragleave.prevent="isDragover = false"
    @drop.prevent="onDrop"
    role="button"
    tabindex="0"
    aria-label="上传文档，支持 TXT、PDF、MD"
    @keydown.enter="triggerInput"
    @keydown.space.prevent="triggerInput"
  >
    <UploadCloudIcon :size="22" :color="isDragover ? 'var(--primary)' : 'var(--primary-light)'" aria-hidden="true" />
    <span class="label-text">{{ uploading ? '上传中...' : '点击或拖拽上传' }}</span>
    <span class="hint">.txt · .pdf · .md</span>
    <input ref="inputEl" type="file" accept=".txt,.pdf,.md" @change="onFileChange" style="display:none" aria-hidden="true" />
  </label>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { UploadCloudIcon } from 'lucide-vue-next'

defineProps({ uploading: { type: Boolean, default: false } })
const emit = defineEmits(['upload'])

const isDragover = ref(false)
const inputEl = ref(null)

function triggerInput() { inputEl.value?.click() }
function onFileChange(e) {
  const file = e.target.files[0]
  if (file) { emit('upload', file); e.target.value = '' }
}
function onDrop(e) {
  isDragover.value = false
  const file = e.dataTransfer.files[0]
  if (file) emit('upload', file)
}
</script>

<style scoped>
.upload-zone {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  margin: 12px; padding: 16px 12px;
  border: 1.5px dashed var(--border-muted); border-radius: 12px;
  background: var(--surface-soft); cursor: pointer;
  transition: border-color 150ms ease-out, background-color 150ms ease-out;
}
.upload-zone:hover, .upload-zone.dragover {
  border-color: var(--primary); background: var(--primary-bg);
}
.upload-zone.uploading { opacity: 0.6; pointer-events: none; }
.label-text { font-size: 13px; font-weight: 600; color: var(--text); margin-top: 4px; }
.hint { font-size: 11px; color: var(--text-muted); }
</style>
