'use strict'
/**
 * Minimal preload. The web app needs no privileged APIs today - it only uses
 * standard browser APIs (Blob downloads in lib/fileio.ts, navigator.clipboard).
 * This just exposes a flag so the UI could branch on "running in desktop" later.
 */
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
})