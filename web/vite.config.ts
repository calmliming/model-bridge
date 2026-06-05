import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// In dev, the Vite server proxies API calls to the backend (port 3000).
// In production the backend serves the built `dist/` directly.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // The Naive UI dependency was removed; the specifier now resolves to a
      // thin compatibility shim backed by the Tailwind UI kit.
      'naive-ui': fileURLToPath(new URL('./src/shims/naive-ui.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3003',
      '/health': 'http://localhost:3003',
    },
  },
})
