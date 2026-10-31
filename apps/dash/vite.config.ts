import tailwindcss from '@tailwindcss/vite'
import { voidSolid } from '@void/solid/plugin'
import solid from 'vite-plugin-solid'
import { defineConfig } from 'vite-plus'
import { voidPlugin } from 'void'

// Vitest renders components in happy-dom, so it compiles Solid for the
// browser; Void's adapter would compile them for its server renderer.
const testing = process.env.VITEST !== undefined

// Pinned dev port (5173 is reserved for apps/app). The Worker calls the api
// itself, so there is no dev proxy.
export default defineConfig({
  plugins: testing
    ? [tailwindcss(), solid({ hot: false })]
    : [tailwindcss(), voidPlugin(), voidSolid({ solid: { hot: false } })],
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'], unstubGlobals: true },
})
