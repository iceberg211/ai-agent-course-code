import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), vue()],
  build: {
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-vue',
              test: /[\\/]node_modules[\\/](vue|@vue|vue-router|pinia)[\\/]/,
            },
            {
              name: 'vendor-ai',
              test: /[\\/]node_modules[\\/](@ai-sdk|ai)[\\/]/,
            },
            {
              name: 'vendor-digital-human',
              test: /[\\/]node_modules[\\/](simli-client)[\\/]/,
            },
            {
              name: 'vendor-markdown',
              test: /[\\/]node_modules[\\/](marked)[\\/]/,
            },
            {
              name: 'vendor-icons',
              test: /[\\/]node_modules[\\/](lucide-vue-next)[\\/]/,
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // REST API 转发
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // WebSocket 转发
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
})
