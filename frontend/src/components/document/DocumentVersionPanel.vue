<template>
  <div class="flex flex-col gap-5 text-left">
    <section class="bg-slate-50 p-4 rounded-lg flex flex-col gap-3">
      <h4 class="m-0 text-[13px] font-bold text-text-main">
        更替上传新版本 (v{{ nextVersion }})
      </h4>
      <div class="flex items-center gap-3 flex-wrap">
        <input type="file" accept=".txt,.md,.pdf,.docx,.xlsx,.pptx" @change="onFileSelected" />
        <button
          v-if="canUpload"
          class="h-9 px-4 bg-gradient-to-br from-blue-500 to-blue-700 text-white border-none rounded-lg text-xs font-bold cursor-pointer disabled:opacity-60"
          type="button"
          :disabled="!selectedFile || uploading"
          @click="$emit('upload', selectedFile!)"
        >
          {{ uploading ? '上传新版本中…' : '上传此版本' }}
        </button>
      </div>
    </section>

    <div class="text-[11px] font-extrabold text-text-muted uppercase tracking-wide border-b border-border-main pb-1.5">
      版本迭代历史
    </div>

    <LoadingSkeleton v-if="loading" :rows="2" :row-height="88" label="加载版本历史" />
    <EmptyState v-else-if="versions.length === 0" title="暂无版本历史" />
    <ul v-else class="list-none m-0 p-0 flex flex-col gap-3">
      <li
        v-for="ver in versions"
        :key="ver.id"
        class="border border-border-main rounded-lg p-3.5 bg-white flex flex-col gap-1.5"
        :class="{ 'border-primary/40 bg-primary/2': isCurrent(ver) }"
      >
        <div class="flex items-center gap-2 flex-wrap">
          <strong class="text-[13.5px] text-text-main">Version v{{ ver.version ?? 1 }}</strong>
          <StatusBadge v-if="isCurrent(ver)" label="当前版本" tone="primary" />
          <StatusBadge v-if="isArchived(ver)" label="已归档" tone="neutral" />
        </div>
        <div class="text-[11px] text-text-muted font-mono">
          ID: {{ ver.id }} · 创建时间: {{ formatDateTime(ver.createdAt || ver.created_at) }}
        </div>
        <div
          v-if="!isCurrent(ver) && !isArchived(ver)"
          class="flex gap-2 mt-1"
        >
          <button
            v-if="canSetCurrent"
            class="px-2.5 py-1 border border-border-main rounded-md bg-white text-[11px] cursor-pointer hover:bg-slate-50"
            type="button"
            @click="$emit('set-current', ver)"
          >
            设为当前版本
          </button>
          <button
            v-if="canArchive"
            class="px-2.5 py-1 border-none bg-transparent text-primary text-[11px] font-bold cursor-pointer hover:underline"
            type="button"
            @click="$emit('archive', ver)"
          >
            归档
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import EmptyState from '@/components/common/EmptyState.vue'
import LoadingSkeleton from '@/components/common/LoadingSkeleton.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import type { KnowledgeDocumentDetail } from '@/types'
import { formatDateTime } from '@/components/document/documentDetail.utils'

defineProps<{
  versions: KnowledgeDocumentDetail[]
  loading: boolean
  nextVersion: number
  canUpload: boolean
  canSetCurrent: boolean
  canArchive: boolean
  uploading: boolean
}>()

defineEmits<{
  (e: 'upload', file: File): void
  (e: 'set-current', version: KnowledgeDocumentDetail): void
  (e: 'archive', version: KnowledgeDocumentDetail): void
}>()

const selectedFile = ref<File | null>(null)

function onFileSelected(e: Event) {
  const target = e.target as HTMLInputElement
  selectedFile.value = target.files?.[0] ?? null
}

function isCurrent(ver: KnowledgeDocumentDetail) {
  return Boolean(ver.isCurrentVersion || ver.is_current_version)
}

function isArchived(ver: KnowledgeDocumentDetail) {
  return Boolean(ver.archivedAt || ver.archived_at)
}
</script>
