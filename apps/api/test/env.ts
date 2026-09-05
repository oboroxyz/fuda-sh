import { env } from 'cloudflare:test'

import { createApp } from '../src/app.ts'
import type { AppDeps } from '../src/app.ts'
import type { Bindings } from '../src/env.ts'

export const testEnv = (overrides: Partial<Bindings> = {}): Bindings => ({
  ...(env as unknown as Bindings),
  ...overrides,
})

export const appWith = (deps: AppDeps) => createApp(deps)
