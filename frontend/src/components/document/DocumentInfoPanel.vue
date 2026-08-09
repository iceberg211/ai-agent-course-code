<template>
  <div class="flex flex-col gap-5 text-left">
    <div class="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg">
      <div class="flex flex-col gap-1">
        <span class="text-[11.5px] text-text-muted">文档 ID</span>
        <span class="text-[13px] font-bold text-text-secondary font-mono break-all">{{ doc.id }}</span>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-[11.5px] text-text-muted">所处阶段</span>
        <StatusBadge
          :label="`${statusLabelOf(doc.status)} (${stageLabelOf(doc.processingStage || doc.processing_stage)})`"
          :status="doc.status"
        />
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-[11.5px] text-text-muted">大小/类型</span>
        <span class="text-[13px] font-bold text-text-secondary">
          {{ formatSize(doc.fileSize ?? doc.file_size) }} ({{ formatType(doc.filename) }})
        </span>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-[11.5px] text-text-muted">入库时间</span>
        <span class="text-[13px] font-bold text-text-secondary">
          {{ formatDateTime(doc.createdAt || doc.created_at) }}
        </span>
      </div>
    </div>

    <div class="text-[11px] font-extrabold text-text-muted uppercase tracking-wide border-b border-border-main pb-1.5">
      动态安全治理控制
    </div>

    <form class="flex flex-col gap-4" @submit.prevent="$emit('save', form)">
      <label class="flex flex-col gap-1.5">
        <span class="text-xs font-bold text-text-secondary">数据可见性范围</span>
        <select v-model="form.visibility" class="h-9.5 px-3 border border-border-main rounded-lg text-xs outline-none focus:border-primary">
          <option value="company">全公司可见 (Company)</option>
          <option value="department">本部门可见 (Department)</option>
          <option value="private">仅上传者可见 (Private)</option>
        </select>
      </label>

      <div class="grid grid-cols-2 gap-4">
        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-bold text-text-secondary">安全密级</span>
          <select v-model.number="form.securityLevel" class="h-9.5 px-3 border border-border-main rounded-lg text-xs outline-none focus:border-primary">
            <option :value="0">公开 (Level 0)</option>
            <option :value="1">内部敏感 (Level 1)</option>
            <option :value="2">核心机密 (Level 2)</option>
          </select>
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-bold text-text-secondary">归属部门</span>
          <input v-model="form.department" type="text" class="h-9.5 px-3 border border-border-main rounded-lg text-xs outline-none focus:border-primary" />
        </label>
      </div>

      <label class="flex flex-col gap-1.5">
        <span class="text-xs font-bold text-text-secondary">标签列表 (逗号分隔)</span>
        <input v-model="form.tags" type="text" class="h-9.5 px-3 border border-border-main rounded-lg text-xs outline-none focus:border-primary" />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-xs font-bold text-text-secondary">业务分类</span>
        <input v-model="form.businessCategory" type="text" class="h-9.5 px-3 border border-border-main rounded-lg text-xs outline-none focus:border-primary" />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-xs font-bold text-text-secondary">过期时间</span>
        <input v-model="form.expiresAt" type="date" class="h-9.5 px-3 border border-border-main rounded-lg text-xs outline-none focus:border-primary" />
      </label>

      <button
        v-if="canEdit"
        type="submit"
        class="self-start h-9.5 px-5 bg-gradient-to-br from-blue-500 to-blue-700 text-white border-none rounded-lg text-xs font-bold cursor-pointer disabled:opacity-60"
        :disabled="saving"
      >
        {{ saving ? '保存中…' : '应用安全设置' }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import type { KnowledgeDocumentDetail } from '@/types'
import {
  dateInputValue,
  formatDateTime,
  formatSize,
  formatType,
  stageLabelOf,
  statusLabelOf,
} from '@/components/document/documentDetail.utils'

export interface GovernanceForm {
  visibility: 'company' | 'department' | 'private'
  securityLevel: number
  department: string
  tags: string
  businessCategory: string
  expiresAt: string
}

const props = defineProps<{
  doc: KnowledgeDocumentDetail
  canEdit: boolean
  saving: boolean
}>()

defineEmits<{
  (e: 'save', form: GovernanceForm): void
}>()

const form = reactive<GovernanceForm>({
  visibility: 'company',
  securityLevel: 0,
  department: '',
  tags: '',
  businessCategory: '',
  expiresAt: '',
})

watch(
  () => props.doc,
  (doc) => {
    form.visibility = (doc.visibility as GovernanceForm['visibility']) || 'company'
    form.securityLevel = doc.securityLevel ?? 0
    form.department = doc.department ?? ''
    form.tags = Array.isArray(doc.tags) ? doc.tags.join(',') : String(doc.tags ?? '')
    form.businessCategory = doc.businessCategory ?? doc.business_category ?? ''
    form.expiresAt = dateInputValue(doc.expiresAt || doc.expires_at)
  },
  { immediate: true },
)
</script>
