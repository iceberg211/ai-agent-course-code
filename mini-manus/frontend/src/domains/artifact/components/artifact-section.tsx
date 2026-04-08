import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ArtifactDetail } from '@/domains/artifact/types/artifact.types'
import { EmptyState } from '@/shared/ui/empty-state'
import { PanelSection } from '@/shared/ui/panel-section'
import { formatDateTime } from '@/shared/utils/date'
import { prettyJson } from '@/shared/utils/text'

interface ArtifactSectionProps {
  artifacts: ArtifactDetail[]
  onSelectArtifact: (artifactId: string) => void
  selectedArtifactId: string | null
}

export function ArtifactSection({
  artifacts,
  onSelectArtifact,
  selectedArtifactId,
}: ArtifactSectionProps) {
  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? artifacts[0] ?? null,
    [artifacts, selectedArtifactId],
  )

  if (!artifacts.length) {
    return (
      <PanelSection title="产物预览" subtitle="最终 Markdown 会出现在这里">
        <EmptyState title="还没有产物" description="任务完成后，这里会展示 Markdown 或文件产物。" />
      </PanelSection>
    )
  }

  const jsonContent =
    selectedArtifact?.type === 'json'
      ? (() => {
          try {
            return prettyJson(JSON.parse(selectedArtifact.content))
          } catch {
            return selectedArtifact.content
          }
        })()
      : null

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
      <div className="artifact-tabs">
        {artifacts.map((artifact) => (
          <button
            key={artifact.id}
            className={
              artifact.id === selectedArtifact?.id
                ? 'artifact-tab artifact-tab--active'
                : 'artifact-tab'
            }
            onClick={() => onSelectArtifact(artifact.id)}
          >
            {artifact.title}
          </button>
        ))}
      </div>

      <div className="artifact-preview">
        {selectedArtifact?.type === 'markdown' ? (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {selectedArtifact.content}
            </ReactMarkdown>
          </div>
        ) : selectedArtifact?.type === 'json' ? (
          <pre>{jsonContent}</pre>
        ) : (
          <div className="artifact-file-placeholder">
            <strong>文件型产物</strong>
            <p>V1 先展示文件描述，不扩展下载器。</p>
            <pre>{selectedArtifact?.content}</pre>
          </div>
        )}
      </div>
    </PanelSection>
  )
}
