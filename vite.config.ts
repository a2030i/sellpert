import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const path = id.replace(/\\/g, '/')
          if (path.includes('/node_modules/recharts/') || path.includes('/node_modules/d3-')) return 'recharts'
          if (path.includes('/node_modules/@supabase/')) return 'supabase'
          if (path.includes('/node_modules/xlsx/')) return 'xlsx'
          return undefined
        },
      },
    },
  },
})
