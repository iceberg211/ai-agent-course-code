import { KNOWLEDGE_DOCUMENT_STATUS_LABELS } from '@/common/constants'

export function formatSize(bytes?: number | null) {
  if (bytes == null) return '-'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

export function formatType(filename: string) {
  const ext = filename.split('.').pop()?.toUpperCase()
  return ext || '未知'
}

export function formatDateTime(val?: string | null) {
  if (!val) return '-'
  const d = new Date(val)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function dateInputValue(val?: string | null) {
  if (!val) return ''
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function formatDuration(start?: string | null, end?: string | null) {
  if (!start || !end) return '未完成'
  const started = new Date(start).getTime()
  const finished = new Date(end).getTime()
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return '-'
  const seconds = Math.round((finished - started) / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function formatMediaTime(ms?: number | null): string {
  if (ms == null) return '00:00'
  const sec = Math.floor(ms / 1000)
  const min = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function assetUrl(asset: Record<string, any>): string {
  return asset.url || asset.storageUrl || asset.storage_url || ''
}

export function statusLabelOf(status?: string): string {
  if (status === 'running') return '处理中'
  if (status === 'skipped') return '已跳过'
  return KNOWLEDGE_DOCUMENT_STATUS_LABELS[status || 'pending'] ?? '未知'
}

export function visibilityLabelOf(visibility?: string): string {
  if (visibility === 'private') return '仅作者'
  if (visibility === 'department') return '本部门'
  return '全公司'
}

export function taskTypeLabelOf(type?: string): string {
  if (type === 'upload_ingest') return '上传入库'
  return type || '文档处理'
}

export function taskStepLabelOf(step?: string): string {
  const labels: Record<string, string> = {
    parse: '解析文件',
    index: '写入索引',
    graph_sync: '同步图谱',
  }
  return labels[step || ''] ?? step ?? '-'
}

const stageLabels: Record<string, string> = {
  uploaded: '已上传',
  parsing: '多模态解析',
  chunking: '分片切分',
  embedding: '向量检索索引',
  keyword_indexing: '全文检索索引',
  graph_indexing: '知识图谱建图',
  completed: '成功',
  failed: '失败',
}

export function stageLabelOf(stage?: string): string {
  return (stageLabels[stage || ''] ?? stage) || '排队'
}
