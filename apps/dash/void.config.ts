import { defineConfig } from 'void/config'

// Void pages behind the dashboard's own Worker
// (docs/adr/0010-void-pages-and-frontend-workers.md). The Worker holds the
// session in HttpOnly cookies and calls the api with it; API_BASE_URL is where.
// `pnpm dev` points it at the local api through the environment.
// The first `void deploy` links the existing `fuda-dash` Worker and writes
// `void.lock.json`, which must then be committed (docs/runbook.md).
export default defineConfig({
  cloudflare: {
    name: 'fuda-dash',
    routes: [{ custom_domain: true, pattern: 'dash.fuda.sh' }],
    vars: { API_BASE_URL: process.env.API_BASE_URL ?? 'https://api.fuda.sh' },
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
      { content: 'width=device-width, initial-scale=1', name: 'viewport' },
      {
        content:
          'Issue membership, loyalty, and ticket cards in minutes. Add them to Apple & Google Wallet. No app, no lock-in, verifiable by anyone.',
        name: 'description',
      },
      { content: 'website', property: 'og:type' },
      { content: 'fuda.', property: 'og:site_name' },
      { content: 'dashboard - fuda.sh', property: 'og:title' },
      {
        content:
          'Issue membership, loyalty, and ticket cards in minutes. Add them to Apple & Google Wallet. No app, no lock-in, verifiable by anyone.',
        property: 'og:description',
      },
      { content: 'https://dash.fuda.sh/', property: 'og:url' },
      { content: 'https://fuda.sh/assets/ogp.png', property: 'og:image' },
      { content: '1200', property: 'og:image:width' },
      { content: '630', property: 'og:image:height' },
      { content: 'en_US', property: 'og:locale' },
      { content: 'summary_large_image', name: 'twitter:card' },
    ],
    title: 'dashboard - fuda.sh',
  },
  inference: { appType: 'void' },
  target: 'cloudflare',
  worker: { compatibility_date: '2025-09-01' },
})
