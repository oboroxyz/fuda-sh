import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'

// Pinned dev port (api CORS accepts any localhost port; 5173 is reserved for apps/app).
export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5175,
    proxy: {
      '/api': {
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/u, ''),
        target: 'http://127.0.0.1:8787',
      },
    },
    strictPort: true,
  },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'], unstubGlobals: true },
})
