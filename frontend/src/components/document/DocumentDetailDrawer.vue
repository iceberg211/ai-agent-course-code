<template>
  <SideDrawer
    :open="open && !!doc"
    title="知识资产详情"
    :subtitle="doc?.filename"
    width="720px"
    @close="$emit('close')"
  >
    <template v-if="doc">
      <section class="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-4" aria-label="文档状态摘要">
        <article
          v-for="item in overviewItems"
          :key="item.label"
          class="flex flex-col gap-1 p-2.5 border border-slate-200/80 rounded-lg bg-slate-50 min-w-0"
        >
          <span class="text-[10.5px] font-extrabold text-text-muted">{{ item.label }}</span>
          <strong class="text-[13px] text-text-main truncate" :class="item.className">{{ item.value }}</strong>
        </article>
      </section>

      <div class="flex gap-1 -mx-6 px-4 mb-4 bg-slate-50 border-y border-border-main overflow-x-auto">
        <button
          v-for="t in detailTabs"
          :key="t.key"
          class="px-3.5 py-3 text-[12.5px] font-semibold text-text-secondary bg-transparent border-none border-b-2 border-transparent cursor-pointer whitespace-nowrap hover:text-primary"
          :class="activeDetailTab === t.key ? '!text-primary !border-b-primary' : ''"
          type="button"
          @click="switchDetailTab(t.key)"
        >
          {{ t.label }}
        </button>
      </div>

      <DocumentInfoPanel
        v-if="activeDetailTab === 'info'"
        :doc="doc"
        :can-edit="canUpload"
        :saving="govSaving"
        @save="saveGovernance"
      />
      <DocumentTaskPanel
        v-else-if="activeDetailTab === 'tasks'"
        :tasks="docTasks"
        :loading="tasksLoading"
      />
      <DocumentMarkdownPanel
        v-else-if="activeDetailTab === 'markdown'"
        :markdown="docMarkdown"
        :loading="markdownLoading"
      />
      <DocumentAssetPanel
        v-else-if="activeDetailTab === 'assets'"
        :assets="docAssets"
        :loading="assetsLoading"
      />
      <DocumentChunkPanel
        v-else-if="activeDetailTab === 'chunks'"
        :chunks="chunks"
        :loading="chunksLoading"
        :can-edit="canUpload"
        @toggle="toggleChunk"
      />
      <DocumentVersionPanel
        v-else-if="activeDetailTab === 'history'"
        :versions="docVersions"
        :loading="versionsLoading"
        :next-version="(doc.version ?? 1) + 1"
        :can-upload="canUpload"
        :can-set-current="canSetCurrentVersion"
        :can-archive="canArchive"
        :uploading="versionUploading"
        @upload="submitVersionUpload"
        @set-current="switchCurrentVersion"
        @archive="archiveVer"
      />
    </template>
  </SideDrawer>

  <ConfirmDialog
    :open="confirmOpen"
    :title="confirmTitle"
    :description="confirmDescription"
    :danger="confirmDanger"
    :loading="confirmLoading"
    @confirm="runConfirmAction"
    @cancel="confirmOpen = false"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import SideDrawer from '@/components/common/SideDrawer.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import DocumentInfoPanel, { type GovernanceForm } from '@/components/document/DocumentInfoPanel.vue'
import DocumentTaskPanel from '@/components/document/DocumentTaskPanel.vue'
import DocumentMarkdownPanel from '@/components/document/DocumentMarkdownPanel.vue'
import DocumentAssetPanel from '@/components/document/DocumentAssetPanel.vue'
import DocumentChunkPanel from '@/components/document/DocumentChunkPanel.vue'
import DocumentVersionPanel from '@/components/document/DocumentVersionPanel.vue'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import type { DocumentTaskItem, KnowledgeChunk, KnowledgeDocumentDetail } from '@/types'
import {
  stageLabelOf,
  statusLabelOf,
  visibilityLabelOf,
} from '@/components/document/documentDetail.utils'

const props = defineProps<{
  open: boolean
  doc: KnowledgeDocumentDetail | null
  canUpload: boolean
  canSetCurrentVersion: boolean
  canArchive: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'updated'): void
}>()

const kbApi = useKnowledgeBase()

const activeDetailTab = ref('info')
const detailTabs = [
  { key: 'info', label: '基本信息与治理' },
  { key: 'tasks', label: '处理任务' },
  { key: 'markdown', label: 'Markdown 预览' },
  { key: 'assets', label: '多模态资产' },
  { key: 'chunks', label: '切片管理' },
  { key: 'history', label: '版本历史' },
]

const chunks = ref<KnowledgeChunk[]>([])
const chunksLoading = ref(false)
const docMarkdown = ref('')
const markdownLoading = ref(false)
const docAssets = ref<Array<Record<string, any>>>([])
const assetsLoading = ref(false)
const docVersions = ref<KnowledgeDocumentDetail[]>([])
const versionsLoading = ref(false)
const docTasks = ref<DocumentTaskItem[]>([])
const tasksLoading = ref(false)
const govSaving = ref(false)
const versionUploading = ref(false)

const confirmOpen = ref(false)
const confirmTitle = ref('')
const confirmDescription = ref('')
const confirmDanger = ref(false)
const confirmLoading = ref(false)
let confirmAction: (() => Promise<void>) | null = null

const overviewItems = computed(() => {
  const doc = props.doc
  if (!doc) return []
  return [
    { label: '解析状态', value: statusLabelOf(doc.status), className: '' },
    { label: '处理阶段', value: stageLabelOf(doc.processingStage || doc.processing_stage), className: '' },
    { label: '切片', value: String(doc.chunkCount ?? doc.chunk_count ?? 0), className: '' },
    { label: '多模态资源', value: String(doc.assetCount ?? doc.asset_count ?? 0), className: '' },
    { label: '可见范围', value: visibilityLabelOf(doc.visibility), className: '' },
  ]
})

watch(
  () => props.doc,
  (newDoc) => {
    if (newDoc) {
      activeDetailTab.value = 'info'
      chunks.value = []
      docMarkdown.value = ''
      docAssets.value = []
      docVersions.value = []
      docTasks.value = []
    }
  },
)

async function switchDetailTab(key: string) {
  activeDetailTab.value = key
  const document = props.doc
  const kbId = document?.knowledgeBaseId || document?.knowledge_base_id
  if (!document || !kbId) return

  if (key === 'tasks') {
    tasksLoading.value = true
    try {
      docTasks.value = await kbApi.listDocumentTasks(document.id)
    } finally {
      tasksLoading.value = false
    }
  } else if (key === 'chunks') {
    chunksLoading.value = true
    try {
      chunks.value = await kbApi.listChunks(kbId, document.id)
    } finally {
      chunksLoading.value = false
    }
  } else if (key === 'markdown') {
    markdownLoading.value = true
    try {
      const res = await kbApi.getDocumentMarkdown(kbId, document.id)
      docMarkdown.value = res?.markdown ?? ''
    } finally {
      markdownLoading.value = false
    }
  } else if (key === 'assets') {
    assetsLoading.value = true
    try {
      docAssets.value = await kbApi.listDocumentAssets(kbId, document.id)
    } finally {
      assetsLoading.value = false
    }
  } else if (key === 'history') {
    versionsLoading.value = true
    try {
      docVersions.value = await kbApi.listDocumentVersions(kbId, document.id)
    } finally {
      versionsLoading.value = false
    }
  }
}

async function toggleChunk(c: KnowledgeChunk) {
  const kbId = props.doc?.knowledgeBaseId || props.doc?.knowledge_base_id
  if (!kbId) return
  const next = !c.enabled
  const ok = await kbApi.setChunkEnabled(kbId, c.id, next)
  if (ok) c.enabled = next
}

async function saveGovernance(form: GovernanceForm) {
  const document = props.doc
  const kbId = document?.knowledgeBaseId || document?.knowledge_base_id
  if (!document || !kbId) return
  govSaving.value = true
  try {
    const updated = await kbApi.updateDocumentGovernance(kbId, document.id, {
      visibility: form.visibility,
      securityLevel: form.securityLevel,
      department: form.department,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      businessCategory: form.businessCategory,
      expiresAt: form.expiresAt || undefined,
    })
    if (updated) emit('updated')
  } finally {
    govSaving.value = false
  }
}

async function submitVersionUpload(file: File) {
  const document = props.doc
  const kbId = document?.knowledgeBaseId || document?.knowledge_base_id
  if (!document || !kbId) return
  versionUploading.value = true
  try {
    const res = await kbApi.uploadDocumentVersion(kbId, document.id, file)
    if (res) {
      await switchDetailTab('history')
      emit('updated')
    }
  } finally {
    versionUploading.value = false
  }
}

function switchCurrentVersion(ver: KnowledgeDocumentDetail) {
  openConfirm({
    title: `切换当前版本为 v${ver.version ?? 1}`,
    description: '切换后检索与问答将优先使用该版本内容。',
    danger: false,
    action: async () => {
      const document = props.doc
      const kbId = document?.knowledgeBaseId || document?.knowledge_base_id
      if (!document || !kbId) return
      const res = await kbApi.setCurrentDocumentVersion(kbId, ver.id)
      if (res) {
        await switchDetailTab('history')
        emit('updated')
      }
    },
  })
}

function archiveVer(ver: KnowledgeDocumentDetail) {
  openConfirm({
    title: `归档版本 v${ver.version ?? 1}`,
    description: '归档后该版本不再作为当前版本使用，可在历史中查看。',
    danger: true,
    action: async () => {
      const document = props.doc
      const kbId = document?.knowledgeBaseId || document?.knowledge_base_id
      if (!document || !kbId) return
      const res = await kbApi.archiveDocument(kbId, ver.id)
      if (res) {
        await switchDetailTab('history')
        emit('updated')
      }
    },
  })
}

function openConfirm(options: {
  title: string
  description: string
  danger: boolean
  action: () => Promise<void>
}) {
  confirmTitle.value = options.title
  confirmDescription.value = options.description
  confirmDanger.value = options.danger
  confirmAction = options.action
  confirmOpen.value = true
}

async function runConfirmAction() {
  if (!confirmAction) return
  confirmLoading.value = true
  try {
    await confirmAction()
    confirmOpen.value = false
  } finally {
    confirmLoading.value = false
    confirmAction = null
  }
}
</script>
