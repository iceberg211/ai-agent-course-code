import { useEffect, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ArtifactDetail } from '@/domains/artifact/types/artifact.types'
import { EmptyState } from '@/shared/ui/empty-state'
import { PanelSection } from '@/shared/ui/panel-section'
import { formatDateTime } from '@/shared/utils/date'
import { prettyJson } from '@/shared/utils/text'

// ─── Sub-renderers ────────────────────────────────────────────────────────────

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

function CodePreview({ content, language }: { content: string; language?: string }) {
  return (
    <pre className="artifact-code">
      <code className={language ? `language-${language}` : undefined}>{content}</code>
    </pre>
  )
}

function DiagramPreview({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // 延迟加载 mermaid，避免 SSR 问题
    void import('mermaid').then((mermaidModule) => {
      const mermaid = mermaidModule.default
      mermaid.initialize({ startOnLoad: false, theme: 'neutral' })

      // 清空旧内容
      if (!containerRef.current) return
      containerRef.current.innerHTML = ''

      // 渲染 mermaid 图
      const id = `mermaid-${Date.now()}`
      void mermaid
        .render(id, content)
        .then(({ svg }) => {
          if (containerRef.current) {
            containerRef.current.innerHTML = svg
          }
        })
        .catch(() => {
          if (containerRef.current) {
            containerRef.current.innerHTML = `<pre>${content}</pre>`
          }
        })
    })
  }, [content])

  return <div ref={containerRef} className="artifact-diagram" />
}

function JsonPreview({ content }: { content: string }) {
  const formatted = useMemo(() => {
    try {
      return prettyJson(JSON.parse(content))
    } catch {
      return content
    }
  }, [content])
  return <pre>{formatted}</pre>
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface ArtifactSectionProps {
  artifacts: ArtifactDetail[]
  onSelectArtifact: (artifactId: string) => void
  selectedArtifactId: string | null
}

const TYPE_LABELS: Record<string, string> = {
  markdown: 'Markdown',
  json: 'JSON',
  file: '文件',
  code: '代码',
  diagram: '图表',
}

export function ArtifactSection({
  artifacts,
  onSelectArtifact,
  selectedArtifactId,
}: ArtifactSectionProps) {
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
            className={
              artifact.id === selectedArtifact?.id
                ? 'artifact-tab artifact-tab--active'
                : 'artifact-tab'
            }
            onClick={() => onSelectArtifact(artifact.id)}
          >
            <span className="artifact-tab__type">{TYPE_LABELS[artifact.type] ?? artifact.type}</span>
            <span className="artifact-tab__title">{artifact.title}</span>
          </button>
        ))}
      </div>

      {/* 按类型渲染内容 */}
      <div className="artifact-preview">
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
            <pre>{selectedArtifact?.content}</pre>
          </div>
        )}
      </div>
    </PanelSection>
  )
}
