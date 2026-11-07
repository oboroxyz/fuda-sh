import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

import { COMPATIBILITY_DATE, COMPATIBILITY_FLAGS, TARGETS } from './targets.ts'

// Tests run inside workerd via @cloudflare/vitest-pool-workers. The pool does not
// support Vitest 5 yet (cloudflare/workers-sdk#15618), so this package runs its
// own Vitest 4 through `vitest run` instead of the Vitest 5 that Vite+ bundles.
// Since its 0.2x line the pool is a Vite plugin — `cloudflareTest(...)` — rather than the old
// `defineWorkersConfig` + `test.poolOptions.workers` shape. The bindings are the
// develop target's (targets.jsonc), with D1 and R2 simulated in memory.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: './test/worker.ts',
      miniflare: {
        bindings: {
          ...TARGETS.develop.vars,
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')),
        },
        compatibilityDate: COMPATIBILITY_DATE,
        compatibilityFlags: COMPATIBILITY_FLAGS,
        d1Databases: ['DB'],
        r2Buckets: ['MEDIA_BUCKET'],
      },
    })),
  ],
  resolve: {
    // Void's build plugin applies the same runtime-only entry in Workers.
    alias: [{ find: /^void$/u, replacement: fileURLToPath(import.meta.resolve('void/handler')) }],
  },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
})
