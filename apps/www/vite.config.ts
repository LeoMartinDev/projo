import { defineConfig } from 'vite'

import { pagesPlugin } from './vite-plugins/pages.ts'

// The public website: static pages rendered per language from src/pages/ (English at /, French
// under /fr/), no framework. It reuses the app's tokens and media queries
// (apps/web/src/shared/styles) and the artwork in design/.
export default defineConfig({
  plugins: [pagesPlugin()],
  css: { transformer: 'lightningcss', lightningcss: { drafts: { customMedia: true } } },
  server: { port: 5175, strictPort: true },
  preview: { port: 4175, strictPort: true },
  build: { outDir: 'dist', assetsDir: 'assets' },
})
