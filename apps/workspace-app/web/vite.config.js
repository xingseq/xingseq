import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// dev 时把 /api 反代到 workspace-app server（默认 3002）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env.WORKSPACE_APP_API || 'http://localhost:3002',
        changeOrigin: true,
        ws: false,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            delete proxyRes.headers['content-length']
          })
        }
      }
    }
  }
})
