import { env } from 'cloudflare:test'
import type { Hex } from 'viem'

import { createApp } from '../src/app.ts'
import type { AppDeps } from '../src/app.ts'
import { FakeChain } from '../src/chain/fake-chain.ts'
import type { Bindings } from '../src/env.ts'

export const testEnv = (overrides: Partial<Bindings> = {}): Bindings => ({
  ...(env as unknown as Bindings),
  ...overrides,
})

export const fakeChain = (opts: { signer?: Hex | null } = {}): FakeChain => new FakeChain(opts)

export const appWith = (deps: AppDeps) => createApp(deps)
