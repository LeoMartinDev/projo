import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const server = 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  // Lightning CSS (already Vite's minifier) resolves the named media queries of `media.css`.
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
