import { web } from '@e2e-dev/web'
import type { E2EConfig } from 'e2e'

import { SURFACES } from './stack.config.ts'
import type { SurfaceName } from './stack.config.ts'

// One config per surface, because every test runs on every target: each run
// starts the api and that surface only, and selects that surface's tests. No
// `agents` key, so no step can call a model.
export const surfaceConfig = (surface: SurfaceName): E2EConfig => ({
  output: `.e2e/${surface}`,
  targets: [
    {
      app: {
        command: {
          args: ['scripts/stack.ts', surface],
          executable: 'node',
          inheritEnv: ['CI'],
          log: `.e2e/logs/${surface}.log`,
          startupTimeout: 120_000,
        },
        url: SURFACES[surface].origin,
      },
      // `locale` also sets Accept-Language, which keeps the English assertions
      // valid now that Japanese is the first-visit default.
      engine: web({ locale: 'en-US', timezoneId: 'Asia/Tokyo' }),
      name: surface,
    },
  ],
  tests: [`tests/${surface}/**/*.e2e.ts`],
  // The surfaces share one api and its D1 state for the whole run.
  workers: 1,
})
