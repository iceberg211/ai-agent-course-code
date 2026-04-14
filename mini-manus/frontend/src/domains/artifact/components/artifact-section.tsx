import { useMemo } from 'react'
import type { ArtifactDetail } from '@/domains/artifact/types/artifact.types'
import { DiagramPreview } from '@/domains/artifact/components/diagram-preview'
import { MarkdownPreview } from '@/domains/artifact/components/markdown-preview'
import { downloadArtifact, getArtifactFilename } from '@/domains/artifact/utils/artifact-download'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { PanelSection } from '@/shared/ui/panel-section'
import { CodePreview, JsonPreview } from '@/shared/ui/code-preview'
import { formatDateTime } from '@/shared/utils/date'

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  markdown: 'Markdown',
  json: 'JSON',
  file: '文件',
  code: '代码',
  diagram: '图表',
}

// ─── ArtifactSection ─────────────────────────────────────────────────────────

interface ArtifactSectionProps {
  artifacts: ArtifactDetail[]
  onSelectArtifact: (artifactId: string) => void
  selectedArtifactId: string | null
}

export function ArtifactSection({ artifacts, onSelectArtifact, selectedArtifactId }: ArtifactSectionProps) {
  const selectedArtifact = useMemo(
    () => artifacts.find((a) => a.id === selectedArtifactId) ?? artifacts[0] ?? null,
    [artifacts, selectedArtifactId],
  )

  if (!artifacts.length) {
    return (
      <PanelSection title="产物预览" subtitle="最终产物会出现在这里">
        <EmptyState title="还没有产物" description="任务完成后，这里会展示报告、代码或图表。" />
      </PanelSection>
    )
  }

  const language =
    typeof selectedArtifact?.metadata?.language === 'string'
      ? selectedArtifact.metadata.language
      : undefined

  return (
    <PanelSection
      title="产物预览"
      subtitle={selectedArtifact?.title ?? '产物'}
      aside={
        selectedArtifact ? (
          <span className="artifact-meta">{formatDateTime(selectedArtifact.createdAt)}</span>
        ) : null
      }
    >
      {/* 产物 tab 切换 */}
      <div className="artifact-tabs">
        {artifacts.map((artifact) => (
          <button
            key={artifact.id}
            className={artifact.id === selectedArtifact?.id ? 'artifact-tab artifact-tab--active' : 'artifact-tab'}
            onClick={() => onSelectArtifact(artifact.id)}
          >
            <span className="artifact-tab__type">{TYPE_LABELS[artifact.type] ?? artifact.type}</span>
            <span className="artifact-tab__title">{artifact.title}</span>
          </button>
        ))}
      </div>

      {/* 按类型渲染内容 */}
      <div className="artifact-preview">
        {selectedArtifact ? (
          <div className="artifact-preview__toolbar">
            <div className="artifact-preview__meta">
              <span className="artifact-preview__pill">
                {TYPE_LABELS[selectedArtifact.type] ?? selectedArtifact.type}
              </span>
              <span>{getArtifactFilename(selectedArtifact)}</span>
            </div>
            <Button variant="ghost" onClick={() => downloadArtifact(selectedArtifact)}>
              下载产物
            </Button>
          </div>
        ) : null}

        {selectedArtifact?.type === 'markdown' ? (
          <MarkdownPreview content={selectedArtifact.content} />
        ) : selectedArtifact?.type === 'code' ? (
          <CodePreview content={selectedArtifact.content} language={language} />
        ) : selectedArtifact?.type === 'diagram' ? (
          <DiagramPreview content={selectedArtifact.content} />
        ) : selectedArtifact?.type === 'json' ? (
          <JsonPreview content={selectedArtifact.content} />
        ) : (
          <div className="artifact-file-placeholder">
            <strong>文件型产物</strong>
            <p>文件名：{getArtifactFilename(selectedArtifact)}</p>
            <p>
              MIME：
              {typeof selectedArtifact?.metadata?.mimeType === 'string'
                ? selectedArtifact.metadata.mimeType
                : 'application/octet-stream'}
            </p>
            {typeof selectedArtifact?.metadata?.sizeBytes === 'number' ? (
              <p>大小：{selectedArtifact.metadata.sizeBytes} bytes</p>
            ) : null}
          </div>
        )}
      </div>
    </PanelSection>
  )
}
