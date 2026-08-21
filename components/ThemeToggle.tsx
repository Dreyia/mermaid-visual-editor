'use client'

import { setThemePref, useThemePref, type ThemePref } from '@/lib/theme'

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/** Three-way appearance control. Lives in the Settings popover. */
export function ThemeToggle() {
  const pref = useThemePref()

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 3,
        padding: 3,
        borderRadius: 6,
        background: 'var(--surface-2)',
        boxShadow: 'var(--neu-shadow-concave)',
      }}
    >
      {OPTIONS.map((opt) => {
        const active = pref === opt.value
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            onClick={() => setThemePref(opt.value)}
            style={{
              border: 'none',
              borderRadius: 6,
              padding: '5px 0',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              background: active ? 'var(--surface)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-2)',
              boxShadow: active ? 'inset 0 0 0 1px var(--border)' : 'none',
              transition: 'background 0.12s, color 0.12s',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
