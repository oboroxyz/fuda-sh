import { preact } from '@preact/preset-vite'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [preact({ reactAliasesEnabled: false })],
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'], unstubGlobals: true },
})
