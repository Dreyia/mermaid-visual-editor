'use client'

import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

interface PreviewPanelProps {
  syntax: string
}

let initialized = false
let renderId = 0

export function PreviewPanel({ syntax }: PreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!initialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'strict',
      })
      initialized = true
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    const render = async () => {
      // Use a unique ID each render to avoid "element already exists" errors
      const id = `mermaid-render-${++renderId}`
      try {
        const { svg } = await mermaid.render(id, syntax)
        if (containerRef.current) {
          containerRef.current.innerHTML = svg
          setError(null)
        }
      } catch (err) {
        // Clean up the leftover element mermaid may have inserted on error
        document.getElementById(id)?.remove()
        setError(err instanceof Error ? err.message : 'Render error')
      }
    }

    render()
  }, [syntax])

  return (
    <div className="w-full h-full flex flex-col" style={{ background: 'var(--surface)' }}>
      <div className="px-4 py-3 border-b backdrop-blur-md flex items-center justify-between" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Mermaid Preview</span>
        {error && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: 'var(--danger)', background: 'var(--accent-soft)' }}>Syntax error</span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4" style={{ background: 'var(--paper)' }}>
        {error ? (
          <div className="text-xs font-mono whitespace-pre-wrap p-3 rounded" style={{ color: 'var(--danger)', background: 'var(--surface-2)' }}>
            {error}
          </div>
        ) : (
          <div ref={containerRef} className="flex items-center justify-center min-h-full" />
        )}
      </div>

      {/* Syntax display */}
      <div className="border-t p-3" style={{ borderColor: 'var(--border)', background: 'var(--code-bg)' }}>
        <pre className="text-xs font-mono overflow-auto max-h-40 whitespace-pre" style={{ color: 'var(--code-fg)' }}>
          {syntax}
        </pre>
      </div>
    </div>
  )
}
