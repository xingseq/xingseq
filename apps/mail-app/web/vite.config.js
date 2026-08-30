import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// dev 时把 /api 反代到 mail-app 网关（默认 7830）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5176,
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env.MAIL_APP_API || 'http://localhost:7830',
        changeOrigin: true
      }
    }
  }
})
