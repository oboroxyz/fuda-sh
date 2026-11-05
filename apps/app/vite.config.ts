import { preactPagesConfig } from '@fuda/ui-preact/vite-pages'

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

export default preactPagesConfig({ port: 5173, prebundled: PREBUNDLED })
