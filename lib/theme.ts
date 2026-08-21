'use client'

import { useSyncExternalStore } from 'react'

/**
 * Theme preference + resolution.
 *
 * The preference is one of three values; the *resolved* theme is only ever
 * 'light' or 'dark' and is written to `document.documentElement`'s `data-theme`
 * attribute. app/globals.css and Tailwind's `dark:` variant both key off that
 * attribute, so it is the single source of truth once the page is running.
 *
 * A matching blocking script in app/layout.tsx stamps the same attribute before
 * first paint, so there is no flash of the wrong palette.
 *
 * Implemented as an external store (rather than useState + useEffect) because
 * the real state lives outside React — in localStorage, in a matchMedia
 * subscription, and on the <html> element.
 */
export type ThemePref = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'mve-theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function isThemePref(v: unknown): v is ThemePref {
  return v === 'system' || v === 'light' || v === 'dark'
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(DARK_QUERY).matches
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref
  return systemPrefersDark() ? 'dark' : 'light'
}

function applyTheme(pref: ThemePref) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', resolveTheme(pref))
}

// ── store ───────────────────────────────────────────────────────────────────
let currentPref: ThemePref = 'system'
let initialized = false
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function init() {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  let stored: string | null = null
  // localStorage can throw in restricted contexts; failure just means
  // "no preference saved".
  try {
    stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  } catch {
    stored = null
  }
  currentPref = isThemePref(stored) ? stored : 'system'
  applyTheme(currentPref)

  if (window.matchMedia) {
    window.matchMedia(DARK_QUERY).addEventListener('change', () => {
      if (currentPref === 'system') {
        applyTheme('system')
        emit()
      }
    })
  }
}

function subscribe(onChange: () => void) {
  init()
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function getSnapshot(): ThemePref {
  init()
  return currentPref
}

// Static export prerenders with no window, so the server snapshot is the
// neutral default; React re-renders with the real value after hydration.
function getServerSnapshot(): ThemePref {
  return 'system'
}

export function setThemePref(next: ThemePref) {
  currentPref = next
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next)
  } catch {
    /* preference just won't persist */
  }
  applyTheme(next)
  emit()
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
