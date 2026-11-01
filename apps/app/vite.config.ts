import tailwindcss from '@tailwindcss/vite'
import { voidSolid } from '@void/solid/plugin'
import solid from 'vite-plugin-solid'
import { defineConfig } from 'vite-plus'
import { voidPlugin } from 'void'

// Vitest renders components in happy-dom, so it compiles Solid for the
// browser; Void's adapter would compile them for its server renderer.
const testing = process.env.VITEST !== undefined

// Dependencies the dev server would otherwise discover on a page's first
// request, re-optimize and reload in the middle of it, failing that render.
const PREBUNDLED = [
  '@base-org/account',
  '@worldcoin/idkit-core',
  'cn',
  'hono/html',
  'uqr',
  'valibot',
  'viem',
  'viem/chains',
]

// Pinned dev port: the member app owns 5173.
export default defineConfig({
  environments: { void_worker: { optimizeDeps: { include: PREBUNDLED } } },
  optimizeDeps: { include: PREBUNDLED },
  plugins: testing
    ? [tailwindcss(), solid({ hot: false })]
    : [tailwindcss(), voidPlugin(), voidSolid({ solid: { hot: false } })],
  server: { port: 5173, strictPort: true },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'], unstubGlobals: true },
})
