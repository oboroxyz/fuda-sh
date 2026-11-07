import { defineConfig } from 'void/config'

import { targetConfig } from '../../targets.ts'

// The e2e stack (packages/e2e/scripts/stack.ts) builds this target with the
// origins of its own ports. It is the `local` target with its own name and Void
// state, and with chain writes simulated and admin routes open, so the suite
// seeds Rights without credentials. A developer's local secrets live in
// targets/local and never reach this build.
const local = targetConfig('local')
const env = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is unset: build this target through packages/e2e/scripts/stack.ts`)
  }
  return value
}

export default defineConfig({
  ...local,
  cloudflare: {
    ...local.cloudflare,
    name: 'fuda-api-e2e',
    vars: {
      ...local.cloudflare?.vars,
      API_BASE_URL: env('E2E_API_ORIGIN'),
      PUBLIC_BASE_URL: env('E2E_APP_ORIGIN'),
      USE_FAKE_CHAIN: '1',
    },
  },
})
