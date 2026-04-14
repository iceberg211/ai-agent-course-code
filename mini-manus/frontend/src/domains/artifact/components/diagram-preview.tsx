import { useEffect, useRef } from 'react'

interface DiagramPreviewProps {
  content: string
}

export function DiagramPreview({ content }: DiagramPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // 延迟加载 mermaid，避免 SSR 问题
    void import('mermaid').then((mermaidModule) => {
      const mermaid = mermaidModule.default
      mermaid.initialize({ startOnLoad: false, theme: 'neutral' })

      if (!containerRef.current) return
      containerRef.current.innerHTML = ''

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
            const pre = document.createElement('pre')
            pre.textContent = content
            containerRef.current.replaceChildren(pre)
          }
        })
    })
  }, [content])

  return <div ref={containerRef} className="artifact-diagram" />
}
