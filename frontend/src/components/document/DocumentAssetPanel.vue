<template>
  <div>
    <LoadingSkeleton v-if="loading" :rows="2" :row-height="160" label="提取多模态资产" />
    <EmptyState v-else-if="assets.length === 0" title="该文档无音视频或图片等多模态资产" />
    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <article
        v-for="asset in assets"
        :key="asset.id"
        class="border border-border-main rounded-xl overflow-hidden bg-white flex flex-col"
      >
        <header class="px-3.5 py-2.5 bg-slate-50 border-b border-border-main flex justify-between items-center text-[11.5px]">
          <StatusBadge :label="asset.assetType || asset.asset_type || 'asset'" tone="info" />
          <span class="font-mono text-text-muted">ID: {{ String(asset.id).slice(0, 8) }}</span>
        </header>
        <div class="p-3.5 flex flex-col gap-2.5">
          <div v-if="isImage(asset)" class="h-40 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-center overflow-hidden">
            <img v-if="assetUrl(asset)" :src="assetUrl(asset)" class="max-w-full max-h-full object-contain" alt="asset preview" />
            <span v-else class="text-xs text-text-muted">图片预览暂不可用</span>
          </div>
          <div v-else-if="isVideo(asset)" class="relative h-40 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-center overflow-hidden">
            <video v-if="assetUrl(asset)" controls :src="assetUrl(asset)" class="w-full max-h-40 rounded-lg" />
            <span v-else class="text-xs text-text-muted">视频预览暂不可用</span>
            <span class="absolute bottom-2 right-2 bg-slate-900/85 text-white text-[9.5px] px-1.5 py-0.5 rounded font-semibold">
              {{ formatMediaTime(asset.startMs ?? asset.start_ms) }} - {{ formatMediaTime(asset.endMs ?? asset.end_ms) }}
            </span>
          </div>
          <div v-else-if="isAudio(asset)">
            <audio v-if="assetUrl(asset)" controls :src="assetUrl(asset)" class="w-full" />
            <span v-else class="text-xs text-text-muted">音频预览暂不可用</span>
          </div>

          <div class="flex items-center justify-between gap-2 text-[11px] text-text-muted">
            <span class="truncate" :title="asset.filename || asset.storageKey || asset.storage_key">
              {{ asset.filename || asset.storageKey || asset.storage_key }}
            </span>
            <span v-if="asset.pageNo || asset.page_no">第 {{ asset.pageNo ?? asset.page_no }} 页</span>
          </div>

          <div v-if="asset.ocrText || asset.ocr_text || asset.caption" class="text-[11.5px] text-left">
            <strong class="text-text-secondary">识别描述/OCR:</strong>
            <p class="m-0 mt-1 text-text-secondary">{{ asset.ocrText || asset.ocr_text || asset.caption }}</p>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import EmptyState from '@/components/common/EmptyState.vue'
import LoadingSkeleton from '@/components/common/LoadingSkeleton.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { assetUrl, formatMediaTime } from '@/components/document/documentDetail.utils'

defineProps<{
  assets: Array<Record<string, any>>
  loading: boolean
}>()

function assetTypeOf(asset: Record<string, any>) {
  return String(asset.assetType || asset.asset_type || '').toLowerCase()
}

function isImage(asset: Record<string, any>) {
  return assetTypeOf(asset) === 'image'
}

function isVideo(asset: Record<string, any>) {
  return assetTypeOf(asset) === 'video'
}

function isAudio(asset: Record<string, any>) {
  return assetTypeOf(asset) === 'audio'
}
</script>
