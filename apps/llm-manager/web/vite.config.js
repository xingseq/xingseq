import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// dev 时把 /api 反代到 llm-manager server（默认 7820）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env.LLM_MANAGER_API || 'http://localhost:7820',
        changeOrigin: true
      }
    }
  }
})
