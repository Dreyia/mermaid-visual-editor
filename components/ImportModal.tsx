'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { parseMermaidFlowchart } from '@/lib/parser'
import type { ParseResult } from '@/lib/parser'
import { useFlowStore } from '@/lib/store'

interface ImportModalProps {
  onClose: () => void
}

export function ImportModal({ onClose }: ImportModalProps) {
  const importDiagram = useFlowStore((s) => s.importDiagram)
  const [value, setValue] = useState('')
  const [result, setResult] = useState<ParseResult | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Live parse feedback with 300ms debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult(null);
      return
    }
    debounceRef.current = setTimeout(() => {
      setResult(parseMermaidFlowchart(value))
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [value])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleImport = useCallback(() => {
    if (!result || result.error) return
    const { nodes, edges, direction, theme, look, curveStyle } = result
    importDiagram(nodes, edges, { direction, theme, look, curveStyle })
    onClose()
  }, [result, importDiagram, onClose])

  const canImport = result !== null && result.error === null && result.nodes.length > 0

  const statusText = () => {
    if (!value.trim()) return null
    if (!result) return <span style={{ color: 'var(--text-3)' }}>Parsing…</span>
    if (result.error) return <span style={{ color: 'var(--danger)' }}>{result.error}</span>
    return (
      <span style={{ color: 'var(--success)' }}>
        {result.nodes.length} node{result.nodes.length !== 1 ? 's' : ''},&nbsp;
        {result.edges.length} edge{result.edges.length !== 1 ? 's' : ''} detected
      </span>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-sm pointer-events-auto"
      style={{ background: 'var(--scrim)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="rounded-xl w-[580px] max-h-[85vh] flex flex-col"
        style={{ background: 'var(--surface)', boxShadow: 'inset 0 0 0 1px var(--border), var(--shadow-float)' }}
        role="dialog"
        aria-labelledby="import-modal-title"
        aria-describedby="import-modal-desc"
        aria-modal="true"
      >

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 id="import-modal-title" className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Import Mermaid Syntax</h2>
            <p id="import-modal-desc" className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Paste a flowchart definition to load it onto the canvas</p>
          </div>
          <button
            onClick={onClose}
            className="transition-colors p-1 rounded-md" style={{ color: 'var(--text-3)' }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Textarea */}
        <div className="flex-1 overflow-hidden flex flex-col p-4 gap-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1 w-full font-mono text-xs rounded-md p-3 resize-none outline-none"
            style={{ color: 'var(--text-1)', background: 'var(--surface-2)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
            placeholder={`flowchart TD\n  A["Start"] --> B{"Decision?"}\n  B --> |"Yes"| C["Do it"]\n  B --> |"No"| D["Skip"]`}
            spellCheck={false}
            rows={14}
            aria-label="Mermaid Syntax"
          />
          <div className="text-xs min-h-[16px]" aria-live="polite">{statusText()}</div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t rounded-b-xl" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-md transition-colors" style={{ color: 'var(--text-2)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!canImport}
            className="px-4 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
          >
            Import to Canvas
          </button>
        </div>
      </div>
    </div>
  )
}
