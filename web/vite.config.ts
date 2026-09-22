import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// In dev, the Vite server proxies API calls to the backend.
// 本地开发的后端端口与线上不同：线上容器对外是 3001，本地默认 3003
// （见 .env.local 的 PORT）。改了后端端口必须同步改这里，
// 否则 npm run dev:all 前端调不到后端。
// Vite 不会自动加载仓库根目录的 .env.local，所以这里显式兜底默认值。
const backendPort = process.env.PORT ?? '3003'
const backendTarget = `http://localhost:${backendPort}`

// In production the backend serves the built `dist/` directly.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': backendTarget,
      '/health': backendTarget,
    },
  },
})
