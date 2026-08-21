'use strict'
/**
 * Electron main process for Mermaid Visual Editor.
 *
 * The upstream project is a Next.js app with `output: 'export'` (see next.config.ts),
 * so `next build` emits a fully static site into `out/`. Rather than spawning the
 * bundled `serve` on localhost (what bin/cli.js does), this wrapper registers a
 * custom `app://` scheme and serves `out/` straight from disk. That keeps the app
 * offline, avoids port conflicts, and still gives the page a "secure context"
 * origin so navigator.clipboard.writeText() works (used by TopToolbar/CommandPalette).
 */

const { app, BrowserWindow, protocol, shell, Menu, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')

const APP_SCHEME = 'app'
const APP_HOST = 'local'
const START_URL = APP_SCHEME + '://' + APP_HOST + '/'

// In dev this is <repo>/out. When packaged by electron-builder it is
// <resources>/app.asar/out - both are reached the same way from __dirname.
const OUT_DIR = path.join(__dirname, '..', 'out')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
}

// `standard` gives the scheme a real origin (needed for localStorage / relative URLs),
// `secure` marks it as a trusted origin so clipboard + other secure-context APIs work.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

/** Map a URL pathname to a real file inside OUT_DIR, or null if it escapes / is missing. */
function resolveFile(pathname) {
  let rel
  try {
    rel = decodeURIComponent(pathname)
  } catch {
    return null
  }
  rel = rel.replace(/^\/+/, '')
  let full = path.normalize(path.join(OUT_DIR, rel))

  // Directory-traversal guard: the resolved path must stay under OUT_DIR.
  if (full !== OUT_DIR && !full.startsWith(OUT_DIR + path.sep)) return null

  try {
    if (fs.statSync(full).isDirectory()) full = path.join(full, 'index.html')
  } catch {
    // next.config.ts sets trailingSlash: true, so routes are directories with an
    // index.html. The `.html` fallback covers a non-trailing-slash request.
    if (fs.existsSync(full + '.html')) full = full + '.html'
  }
  return fs.existsSync(full) ? full : null
}

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveFile(new URL(request.url).pathname)
    if (!file) {
      return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } })
    }
    const data = await fsp.readFile(file)
    return new Response(data, {
      status: 200,
      headers: {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        // Mirrors the security headers next.config.ts sets for `next start`.
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      },
    })
  })
}

function buildMenu(win) {
  const template = [
    {
      label: 'File',
      submenu: [{ role: 'quit', label: 'Exit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Project on GitHub',
          click: () => shell.openExternal('https://github.com/saketkattu/mermaid-visual-editor'),
        },
        {
          label: 'Mermaid.js Docs',
          click: () => shell.openExternal('https://mermaid.js.org'),
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'About',
              message: 'Mermaid Visual Editor',
              detail:
                'Desktop build (Electron ' + process.versions.electron + ')\n' +
                'Chromium ' + process.versions.chrome + ' - Node ' + process.versions.node + '\n\n' +
                'Upstream: github.com/saketkattu/mermaid-visual-editor (MIT)',
            })
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Mermaid Visual Editor',
    // Matches --neu-bg in app/globals.css, so there is no white flash on launch.
    backgroundColor: '#E0E5EC',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => win.show())
  buildMenu(win)

  // Anything that tries to open a new window (external links) goes to the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Keep in-window navigation inside the bundled app.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_SCHEME + '://' + APP_HOST)) {
      event.preventDefault()
      if (/^https?:/i.test(url)) shell.openExternal(url)
    }
  })

  win.loadURL(START_URL)
  return win
}

// Only one instance; a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow = null

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    if (!fs.existsSync(path.join(OUT_DIR, 'index.html'))) {
      dialog.showErrorBox(
        'Build output missing',
        'Could not find the static export at:\n' + OUT_DIR + '\n\n' +
          'Run "pnpm build" (or "pnpm desktop") in the project folder first.'
      )
      app.quit()
      return
    }
    registerAppProtocol()
    mainWindow = createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}