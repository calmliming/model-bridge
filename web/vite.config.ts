import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// In dev, the Vite server proxies API calls to the backend (port 3000).
// In production the backend serves the built `dist/` directly.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
})
