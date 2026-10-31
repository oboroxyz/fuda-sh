import tailwindcss from '@tailwindcss/vite'
import solid from 'vite-plugin-solid'
import { defineConfig } from 'vite-plus'

// Pinned dev port (api CORS accepts any localhost port; 5173 is reserved for apps/app).
export default defineConfig({
  plugins: [tailwindcss(), solid()],
  server: { port: 5174, strictPort: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'], unstubGlobals: true },
})
