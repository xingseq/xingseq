import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// dev 时把 /console 反代到控制台网关（electron-shell 主进程内的 http 服务，默认 5180）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    strictPort: false,
    proxy: {
      '/console': {
        target: process.env.CONSOLE_GATEWAY || 'http://localhost:5180',
        changeOrigin: true,
        ws: false
      }
    }
  }
})
