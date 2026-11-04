import { readFileSync } from 'node:fs'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { serviceWorkerPlugin } from './vite-plugins/service-worker.ts'

const server = 'http://localhost:8080'

const rootPackage = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string }
const version = process.env['PROJO_VERSION'] || rootPackage.version

export default defineConfig({
  plugins: [react(), serviceWorkerPlugin({ version })],
  define: { __PROJO_VERSION__: JSON.stringify(version) },
  css: { transformer: 'lightningcss', lightningcss: { drafts: { customMedia: true } } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: server, changeOrigin: false },
      '/health': { target: server },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
})
