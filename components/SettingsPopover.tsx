'use client'

import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useFlowStore } from '@/lib/store'
import { serialize } from '@/lib/serializer'
import { downloadMmd, saveDiagramJson, loadDiagramJson } from '@/lib/fileio'
import { ImportModal } from '@/components/ImportModal'
import { ThemeToggle } from '@/components/ThemeToggle'

interface SettingsPopoverProps {
  onClose: () => void
}

const NEU_BG = 'var(--neu-bg)'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function NeuBtn({
  onClick,
  disabled,
  active,
  children,
  title,
}: {
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: NEU_BG,
        border: 'none',
        borderRadius: 6,
        boxShadow: active ? 'var(--neu-shadow-inset)' : 'var(--neu-shadow-raised)',
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 500,
        color: active ? 'var(--accent)' : 'var(--text-2)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'box-shadow 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

export function SettingsPopover({ onClose }: SettingsPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const { loadDiagram, assignToSubgraph } = useFlowStore(
    useShallow((s) => ({
      loadDiagram: s.loadDiagram,
      assignToSubgraph: s.assignToSubgraph,
    }))
  )

  const nodesLength = useFlowStore((s) => s.nodes.length)
  const selectedWithParent = useFlowStore(
    useShallow((s) => s.nodes.filter((n) => n.selected && !n.data.isSubgraph && n.parentId))
  )

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !importOpen) onClose() }
    const handleClick = (e: MouseEvent) => {
      // ImportModal is rendered as a SIBLING of this popover, not a child, so every
      // click inside it counts as "outside" and would close the popover - which
      // unmounts the modal mid-interaction. The Escape handler above already guards
      // on importOpen; this one has to as well.
      if (importOpen) return
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', handleKey)
    document.addEventListener('mousedown', handleClick)
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [onClose, importOpen])

  const handleLoad = async () => {
    try {
      setLoadError(null)
      const { nodes: n, edges: e } = await loadDiagramJson()
      loadDiagram(n, e)
      onClose()
    } catch (err) {
      if (err instanceof Error && err.message !== 'No file selected') {
        setLoadError('Invalid file')
        setTimeout(() => setLoadError(null), 3000)
      }
    }
  }

  const handleSave = () => {
    const { nodes, edges } = useFlowStore.getState()
    saveDiagramJson(nodes, edges)
  }

  const handleDownloadMmd = () => {
    const { nodes, edges, direction: dir, theme: t, look: l, curveStyle: c } = useFlowStore.getState()
    downloadMmd(nodes, edges, { direction: dir, theme: t, look: l, curveStyle: c })
  }

  const handleExportSvg = async () => {
    try {
      const { nodes, edges, direction: dir, theme: t, look: l, curveStyle: c } = useFlowStore.getState()
      const mermaid = (await import('mermaid')).default
      const syntax = serialize(nodes, edges, { direction: dir, theme: t, look: l, curveStyle: c })
      const { svg } = await mermaid.render(`svg-export-${Date.now()}`, syntax)
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'diagram.svg'
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore render errors */ }
  }

  return (
    <>
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
      <div
        ref={ref}
        style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          background: NEU_BG,
          borderRadius: 10,
          boxShadow: 'var(--neu-shadow-raised)',
          padding: '20px',
          zIndex: 50,
          width: 280,
        }}
      >
        {/* File */}
        <Section title="File">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <NeuBtn onClick={handleLoad} title="Load diagram from .json">
              {loadError ? '⚠ Error' : 'Load JSON'}
            </NeuBtn>
            <NeuBtn onClick={handleSave} disabled={nodesLength === 0} title="Save as .json">Save JSON</NeuBtn>
            <NeuBtn onClick={() => setImportOpen(true)} title="Import Mermaid syntax">Import .mmd</NeuBtn>
            <NeuBtn onClick={handleDownloadMmd} disabled={nodesLength === 0} title="Download .mmd">Download .mmd</NeuBtn>
            <NeuBtn onClick={handleExportSvg} disabled={nodesLength === 0} title="Export as SVG">Export SVG</NeuBtn>
          </div>
        </Section>

        {/* Appearance */}
        <Section title="Appearance">
          <ThemeToggle />
        </Section>

        {/* Objects */}
        {selectedWithParent.length > 0 && (
          <Section title="Objects">
            <NeuBtn
              onClick={() => assignToSubgraph(selectedWithParent.map((n) => n.id), null)}
              title="Remove selected nodes from their group"
            >
              Ungroup
            </NeuBtn>
          </Section>
        )}
      </div>
    </>
  )
}
