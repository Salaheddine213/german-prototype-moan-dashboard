import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const VENDOR_CHUNKS: Record<string, string[]> = {
  'react-vendor': ['react', 'react-dom', 'react-router-dom'],
  'query-vendor': ['@tanstack/react-query'],
  'chart-echarts': ['echarts', 'echarts-for-react'],
  'chart-tradingview': ['lightweight-charts'],
  'state-utils': ['zustand', 'date-fns', 'lucide-react'],
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          for (const [chunk, packages] of Object.entries(VENDOR_CHUNKS)) {
            if (packages.some((pkg) => id.includes(`node_modules/${pkg}/`))) return chunk
          }
          return undefined
        },
      },
    },
  },
})
