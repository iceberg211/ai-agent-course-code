import React, { useMemo } from 'react'
import JsonView from '@uiw/react-json-view'
import { darkTheme } from '@uiw/react-json-view/dark'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface JsonPreviewProps {
  content: string | object
}

export function JsonPreview({ content }: JsonPreviewProps) {
  const jsonObject = useMemo(() => {
    if (typeof content === 'object' && content !== null) return content

    try {
      return JSON.parse(content as string)
    } catch {
      return null
    }
  }, [content])

  if (!jsonObject) {
    return (
      <pre className="artifact-code language-json">
        <code>{typeof content === 'string' ? content : JSON.stringify(content)}</code>
      </pre>
    )
  }

  return (
    <div
      className="artifact-code"
      style={{
        background: '#1e1e1e',
        padding: '18px',
        borderRadius: '8px',
        boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.2)',
        marginTop: '16px',
        overflow: 'auto',
      }}
    >
      <JsonView
        value={jsonObject}
        style={darkTheme}
        collapsed={2}
        displayDataTypes={false}
        displayObjectSize={true}
      />
    </div>
  )
}

interface CodePreviewProps {
  content: string
  language?: string
}

export function CodePreview({ content, language }: CodePreviewProps) {
  return (
    <div className="artifact-code-wrapper" style={{ margin: '16px 0 0' }}>
      <SyntaxHighlighter
        style={vscDarkPlus as any}
        language={language || 'text'}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: '18px',
          borderRadius: '8px',
          background: '#1e1e1e',
          fontSize: '13px',
        }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  )
}
