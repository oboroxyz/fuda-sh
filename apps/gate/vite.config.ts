import { preact } from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'
import { voidPlugin } from 'void'

// Pinned dev port (5173 is reserved for apps/app).
export default defineConfig({
  plugins: [tailwindcss(), preact({ reactAliasesEnabled: false }), voidPlugin()],
  server: { port: 5174, strictPort: true },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'], unstubGlobals: true },
})
