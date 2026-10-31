import { defineConfig } from 'void/config'

// A static SPA with no backend: Void uploads `dist` and answers unknown paths
// with index.html. Workers Static Assets canonicalizes a literal `@` in an
// unknown path to `%40`, so `/@<handle>` routes are rewritten to the SPA shell
// before the asset lookup (rewrites run first). The first `void deploy` links
// the existing `fuda-app` Worker and writes `void.lock.json`, which must then
// be committed (docs/adr/0009-void-and-solid.md, docs/runbook.md).
export default defineConfig({
  cloudflare: {
    name: 'fuda-app',
    routes: [{ custom_domain: true, pattern: 'app.fuda.sh' }],
  },
  inference: { appType: 'spa', build: 'vp build', outputDir: 'dist' },
  routing: {
    notFound: 'single-page-application',
    rewrites: { '/@*': '/index.html' },
  },
  target: 'cloudflare',
  worker: { compatibility_date: '2025-09-01' },
})
