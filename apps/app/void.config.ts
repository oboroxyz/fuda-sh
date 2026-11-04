import { defineConfig } from 'void/config'

// Void pages behind the member app's own Worker
// (docs/adr/0010-void-pages-and-frontend-workers.md). The Worker holds the
// member session in an HttpOnly cookie and calls the api with it;
// API_BASE_URL is where. `pnpm dev` points it at the local api through the
// environment. `void deploy` records the generated config in `void.lock.json`,
// which is committed (docs/runbook.md).
const DESCRIPTION =
  'Issue membership, loyalty, and ticket cards in minutes. Add them to Apple & Google Wallet. No app, no lock-in, verifiable by anyone.'

export default defineConfig({
  cloudflare: {
    name: 'fuda-app',
    routes: [{ custom_domain: true, pattern: 'app.fuda.sh' }],
    vars: process.env.API_BASE_URL === undefined ? undefined : { API_BASE_URL: process.env.API_BASE_URL },
  },
  head: {
    link: [
      // A copy of packages/ui/src/favicon.svg: a pages app has no index.html
      // for Vite to resolve the shared file from.
      { href: '/favicon.svg', rel: 'icon', type: 'image/svg+xml' },
      { href: 'https://fonts.googleapis.com', rel: 'preconnect' },
      { crossorigin: '', href: 'https://fonts.gstatic.com', rel: 'preconnect' },
      { href: 'https://fonts.googleapis.com/css2?family=Quicksand:wght@700&display=swap', rel: 'stylesheet' },
    ],
    meta: [
      { charset: 'utf-8' },
      { content: 'width=device-width, initial-scale=1, viewport-fit=cover', name: 'viewport' },
      { content: DESCRIPTION, name: 'description' },
      { content: 'website', property: 'og:type' },
      { content: 'fuda.', property: 'og:site_name' },
      { content: 'app - fuda.sh', property: 'og:title' },
      { content: DESCRIPTION, property: 'og:description' },
      { content: 'https://app.fuda.sh/', property: 'og:url' },
      { content: 'https://fuda.sh/assets/ogp.png', property: 'og:image' },
      { content: '1200', property: 'og:image:width' },
      { content: '630', property: 'og:image:height' },
      { content: 'en_US', property: 'og:locale' },
      { content: 'summary_large_image', name: 'twitter:card' },
    ],
    title: 'app - fuda.sh',
  },
  inference: { appType: 'void', build: 'vp build' },
  target: 'cloudflare',
  worker: { compatibility_date: '2025-09-01' },
})
