import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Mermaid Visual Editor',
  description: 'Visual drag-and-drop editor for Mermaid.js diagrams',
}

/**
 * Resolves the saved theme preference and stamps data-theme on <html> BEFORE
 * first paint, so there is no flash of the wrong palette. Kept in sync with
 * lib/theme.ts (same storage key, same resolution rule).
 */
const THEME_INIT = `(function(){try{var p=localStorage.getItem('mve-theme')||'system';var d=p==='dark'||(p!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light')}catch(e){document.documentElement.setAttribute('data-theme','light')}})();`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="antialiased" suppressHydrationWarning>{children}</body>
    </html>
  )
}
