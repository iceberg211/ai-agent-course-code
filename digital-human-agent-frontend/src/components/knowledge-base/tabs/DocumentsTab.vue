<template>
  <div class="documents-tab">
    <section class="upload">
      <label class="upload__dropzone">
        <UploadCloudIcon :size="20" />
        <span v-if="hook.uploading.value">上传中…</span>
        <span v-else>选择文档（PDF / Markdown / TXT），点击或拖拽</span>
        <input
          type="file"
          accept=".pdf,.txt,.md,.markdown,.csv,.json,.log"
          :disabled="hook.uploading.value"
          @change="onFileSelected"
        />
      </label>
      <p v-if="uploadError" class="error">{{ uploadError }}</p>
    </section>

    <section class="doc-list">
      <header class="doc-list__head">
        <h3>已上传文档</h3>
        <span class="badge">{{ documents.length }}</span>
      </header>

      <div v-if="hook.documentsLoading.value" class="muted">加载中…</div>
      <div v-else-if="documents.length === 0" class="empty">暂无文档</div>

      <ul v-else class="docs" role="list">
        <li v-for="doc in documents" :key="doc.id" class="doc">
          <button class="doc__row" @click="toggleExpand(doc.id)" :aria-expanded="expanded === doc.id">
            <FileTextIcon :size="16" />
            <span class="doc__name">{{ doc.filename }}</span>
            <span class="doc__status" :class="`status--${doc.status}`">{{ statusLabel(doc.status) }}</span>
            <span class="doc__meta">{{ doc.chunkCount ?? 0 }} 段</span>
            <ChevronDownIcon :size="14" class="doc__chevron" :class="{ 'doc__chevron--open': expanded === doc.id }" />
          </button>

          <button class="doc__delete" :aria-label="'删除 ' + doc.filename" @click.stop="deleteDoc(doc)">
            <Trash2Icon :size="14" />
          </button>

          <div v-if="expanded === doc.id" class="chunks">
            <div v-if="hook.chunksLoading.value" class="muted">chunks 加载中…</div>
            <ul v-else class="chunk-list" role="list">
              <li v-for="c in chunks" :key="c.id" class="chunk">
                <header class="chunk__head">
                  <span class="chunk__idx">§ {{ c.chunkIndex }}</span>
                  <span class="chunk__count">{{ c.charCount }} 字</span>
                  <label class="toggle">
                    <input type="checkbox" :checked="c.enabled" @change="toggleChunk(c)" />
                    <span>{{ c.enabled ? '启用' : '禁用' }}</span>
                  </label>
                </header>
                <p class="chunk__body">{{ c.content }}</p>
              </li>
            </ul>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  ChevronDownIcon,
  FileTextIcon,
  Trash2Icon,
  UploadCloudIcon,
} from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import type {
  KnowledgeChunk,
  KnowledgeDocumentDetail,
} from '@/types'

const props = defineProps<{ kbId: string }>()
const hook = useKnowledgeBase()

const documents = ref<KnowledgeDocumentDetail[]>([])
const expanded = ref<string | null>(null)
const chunks = ref<KnowledgeChunk[]>([])
const uploadError = ref('')

async function refresh() {
  documents.value = await hook.listDocuments(props.kbId)
}

onMounted(refresh)

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploadError.value = ''
  const result = await hook.uploadDocument(props.kbId, file)
  input.value = ''
  if (!result) {
    uploadError.value = '上传失败，请检查文件格式（支持 PDF / TXT / MD）或稍后重试'
    return
  }
  await refresh()
}

async function deleteDoc(doc: KnowledgeDocumentDetail) {
  if (!confirm(`确定删除文档「${doc.filename}」？其 chunks 会一并清除。`)) return
  const ok = await hook.deleteDocument(props.kbId, doc.id)
  if (ok) {
    if (expanded.value === doc.id) expanded.value = null
    await refresh()
  }
}

async function toggleExpand(docId: string) {
  if (expanded.value === docId) {
    expanded.value = null
    chunks.value = []
    return
  }
  expanded.value = docId
  chunks.value = await hook.listChunks(props.kbId, docId)
}

async function toggleChunk(c: KnowledgeChunk) {
  const next = !c.enabled
  const ok = await hook.setChunkEnabled(props.kbId, c.id, next)
  if (ok) c.enabled = next
}

function statusLabel(s: string) {
  return { pending: '排队中', processing: '处理中', completed: '就绪', failed: '失败' }[s] ?? s
}
</script>

<style scoped>
.documents-tab { display: flex; flex-direction: column; gap: 20px; padding: 4px 0; }

.upload { display: flex; flex-direction: column; gap: 6px; }
.upload__dropzone {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px;
  border: 2px dashed var(--border);
  border-radius: 12px;
  cursor: pointer;
  background: var(--surface);
  color: var(--text-secondary);
  transition: border-color 150ms, background 150ms;
}
.upload__dropzone:hover { border-color: var(--primary); background: var(--primary-bg); }
.upload__dropzone input { display: none; }
.error { margin: 0; color: var(--error); font-size: 12px; }

.doc-list__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.doc-list__head h3 { margin: 0; font-size: 14px; font-weight: 600; }
.badge { padding: 1px 8px; border-radius: 10px; background: var(--primary-bg); color: var(--primary); font-size: 11px; font-weight: 600; }
.muted, .empty { padding: 16px; color: var(--text-muted); font-size: 13px; }

.docs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.doc {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}
.doc__row {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto auto auto;
  gap: 10px;
  align-items: center;
  padding: 10px 44px 10px 12px;
  background: none;
  border: none;
  font: inherit;
  cursor: pointer;
  text-align: left;
  color: var(--text);
}
.doc__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.doc__status { font-size: 11px; padding: 2px 6px; border-radius: 6px; }
.status--completed { color: var(--success); background: #ecfdf5; }
.status--processing { color: var(--warning); background: #fffbeb; }
.status--failed { color: var(--error); background: #fef2f2; }
.status--pending { color: var(--text-secondary); background: #f1f5f9; }
.doc__meta { font-size: 11px; color: var(--text-muted); }
.doc__chevron { transition: transform 150ms; color: var(--text-muted); }
.doc__chevron--open { transform: rotate(180deg); }
.doc__delete {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.doc__delete:hover { background: var(--error); color: #fff; }

.chunks { border-top: 1px solid var(--border); padding: 8px 12px 12px; }
.chunk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.chunk {
  border: 1px solid var(--border-muted);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--primary-bg);
}
.chunk__head { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; }
.chunk__idx { font-weight: 600; color: var(--primary); }
.chunk__count { font-variant-numeric: tabular-nums; }
.toggle { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.toggle input { accent-color: var(--primary); }
.chunk__body {
  margin: 0;
  font-size: 12px;
  color: var(--text);
  white-space: pre-wrap;
  max-height: 120px;
  overflow-y: auto;
  line-height: 1.5;
}
</style>
