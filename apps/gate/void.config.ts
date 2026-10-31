import { defineConfig } from 'void/config'

// A Void SPA with one API route: the scanner renders in the browser from
// index.html, as soon as its script runs, and verifies through the Worker's
// same-origin /api, which calls the api at API_BASE_URL
// (docs/adr/0010-void-pages-and-frontend-workers.md). It has no session and no
// page worth rendering on the server, so it does not use pages. `pnpm dev`
// points API_BASE_URL at the local api through the environment. The first
// `void deploy` links the existing `fuda-gate` Worker and writes
// `void.lock.json`, which must then be committed (docs/runbook.md).
export default defineConfig({
  cloudflare: {
    name: 'fuda-gate',
    routes: [{ custom_domain: true, pattern: 'gate.fuda.sh' }],
    vars: { API_BASE_URL: process.env.API_BASE_URL ?? 'https://api.fuda.sh' },
  },
  inference: { appType: 'void' },
  target: 'cloudflare',
  worker: { compatibility_date: '2025-09-01' },
})
