import { preactPagesConfig } from '@fuda/ui-preact/vite-pages'

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

export default preactPagesConfig({ host: '127.0.0.1', port: 5175, prebundled: PREBUNDLED })
