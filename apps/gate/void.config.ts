import { defineConfig } from 'void/config'

// A Void SPA with one API route: the scanner renders in the browser from
// index.html, as soon as its script runs, and verifies through the Worker's
// same-origin /api, which calls the api at API_BASE_URL
// (../../docs/architecture.md#frontend-workers). It has no session and no
// page worth rendering on the server, so it does not use pages. `pnpm dev`
// points API_BASE_URL at the local api through the environment. `void deploy`
// records the generated config in `void.lock.json`, which is committed
// (docs/runbook.md).
export default defineConfig({
  cloudflare: {
    name: 'fuda-gate',
    routes: [{ custom_domain: true, pattern: 'gate.fuda.sh' }],
    vars: process.env.API_BASE_URL === undefined ? undefined : { API_BASE_URL: process.env.API_BASE_URL },
  },
  inference: { appType: 'void', build: 'vp build' },
  // The scanner is the only page, at `/`. Without this, the Worker asks the assets
  // about any GET that answered 404, and the assets' single-page fallback would
  // turn an api 404 from `/api/*` into index.html with a 200.
  routing: { notFound: 'none' },
  target: 'cloudflare',
  worker: { compatibility_date: '2025-09-01' },
})
