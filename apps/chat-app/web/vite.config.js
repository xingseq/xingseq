import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// dev 时把 /api 反代到 server.mjs（默认 3001）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env.CHAT_APP_API || 'http://localhost:3001',
        changeOrigin: true,
        // SSE 必须保持长连接 + 不缓冲
        ws: false,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            // 保险起见再次禁用缓冲
            delete proxyRes.headers['content-length']
          })
        }
      }
    }
  }
})
