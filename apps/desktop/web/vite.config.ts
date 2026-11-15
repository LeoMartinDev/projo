import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The desktop app's bundled UI (PRODUCT.md §28.1): `@projo/web-app` with the desktop host, served
// by Tauri at http://tauri.localhost from web/dist (tauri.conf.json `frontendDist`). No dev
// server: the page must be on the origin the server's CORS allows, so `tauri dev` builds it too.
// `__PROJO_VERSION__` is the desktop app's own version (§28.10), not the server's: the UI ships
// with the app.
const desktopPackage = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string }
const version = desktopPackage.version

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  define: { __PROJO_VERSION__: JSON.stringify(version) },
  css: { transformer: 'lightningcss', lightningcss: { drafts: { customMedia: true } } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
  },
})
