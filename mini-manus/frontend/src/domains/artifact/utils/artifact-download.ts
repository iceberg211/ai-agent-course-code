import type { ArtifactDetail } from '@/domains/artifact/types/artifact.types'

const TYPE_EXTENSIONS: Record<string, string> = {
  markdown: 'md',
  json: 'json',
  file: 'bin',
  code: 'txt',
  diagram: 'mmd',
}

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  json: 'json',
  bash: 'sh',
  shell: 'sh',
  html: 'html',
  css: 'css',
  sql: 'sql',
}

function sanitizeFilenamePart(input: string) {
  return input.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-_]+/g, '_').replace(/^_+|_+$/g, '')
}

export function getArtifactFilename(artifact: ArtifactDetail): string {
  const metadataName =
    typeof artifact.metadata?.fileName === 'string' ? artifact.metadata.fileName : null
  if (metadataName) return metadataName

  const extension =
    artifact.type === 'code' && typeof artifact.metadata?.language === 'string'
      ? (LANGUAGE_EXTENSIONS[artifact.metadata.language] ?? artifact.metadata.language)
      : (TYPE_EXTENSIONS[artifact.type] ?? 'txt')

  return `${sanitizeFilenamePart(artifact.title || 'artifact')}.${extension}`
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadArtifact(artifact: ArtifactDetail): void {
  const filename = getArtifactFilename(artifact)

  if (
    artifact.type === 'file' &&
    artifact.metadata?.encoding === 'base64' &&
    typeof artifact.metadata?.mimeType === 'string'
  ) {
    const binary = atob(artifact.content)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    triggerDownload(new Blob([bytes], { type: artifact.metadata.mimeType }), filename)
    return
  }

  const mimeType =
    artifact.type === 'json'
      ? 'application/json'
      : artifact.type === 'markdown'
        ? 'text/markdown'
        : 'text/plain'

  triggerDownload(new Blob([artifact.content], { type: mimeType }), filename)
}
