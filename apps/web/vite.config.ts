import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const server = 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
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
