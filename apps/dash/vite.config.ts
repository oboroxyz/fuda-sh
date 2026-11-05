import { preact } from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'
import { voidPlugin } from 'void'
import { voidPreact } from 'void-preact/plugin'

// Vitest renders components in happy-dom, so it compiles them for the browser;
// Void's adapter would compile them for its server renderer.
const testing = process.env.VITEST !== undefined

// Dependencies the dev server would otherwise discover on a page's first
// request, re-optimize and reload in the middle of it, failing that render.
const PREBUNDLED = [
  '@fuda/libs > @base-org/account',
  '@fuda/libs > @simplewebauthn/browser',
  'cn',
  'hono/html',
  '@fuda/sdk > uqr',
  '@fuda/ui > jsqr',
  'valibot',
  'viem',
  'viem/chains',
]

// Pinned dev port (5173 is reserved for apps/app). The Worker calls the api
// itself, so there is no dev proxy.
export default defineConfig({
  environments: { void_worker: { optimizeDeps: { include: PREBUNDLED } } },
  optimizeDeps: { include: PREBUNDLED },
  plugins: testing
    ? [tailwindcss(), preact({ prefreshEnabled: false, reactAliasesEnabled: false })]
    : [
        tailwindcss(),
        voidPlugin(),
        voidPreact({ preact: { prefreshEnabled: false, reactAliasesEnabled: false } }),
      ],
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'], unstubGlobals: true },
})
