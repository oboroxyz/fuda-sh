import { defineConfig } from 'void/config'

// A static SPA with no backend: Void uploads `dist` and answers unknown paths
// with index.html. The first `void deploy` links the existing `fuda-dash`
// Worker and writes `void.lock.json`, which must then be committed
// (docs/adr/0009-void-and-solid.md, docs/runbook.md).
export default defineConfig({
  cloudflare: {
    name: 'fuda-dash',
    routes: [{ custom_domain: true, pattern: 'dash.fuda.sh' }],
  },
  inference: { appType: 'spa', build: 'vp build', outputDir: 'dist' },
  routing: { notFound: 'single-page-application' },
  target: 'cloudflare',
  worker: { compatibility_date: '2025-09-01' },
})
