import { env } from 'cloudflare:test'
import type { Hex } from 'viem'

import { FakeChain } from '../src/chain/fake-chain.ts'
import type { Bindings } from '../src/env.ts'
import type { AppDeps } from '../src/request.ts'
import type { DevBindings } from '../src/runtime.ts'
import { createApp } from './app.ts'

// `env` carries the develop target's vars (see vite.config.ts), which include a
// live ENS topology. Strip the local-dev chain opt-in, any signer or RPC, and
// every wallet-platform, ENS and World ID name, so each "unconfigured → 501"
// test starts unconfigured and a test that wants one of them opts in explicitly.
export const testEnv = (overrides: Partial<Bindings> = {}): Bindings => {
  const base: DevBindings = {
    ...(env as unknown as DevBindings),
    APPLE_CERT_PEM: undefined,
    APPLE_KEY_PEM: undefined,
    APPLE_PASS_TYPE_ID: undefined,
    APPLE_TEAM_ID: undefined,
    APPLE_WWDR_PEM: undefined,
    BASE_RPC_URL: undefined,
    ENS_GAS_POLICY_ID: undefined,
    ENS_GATEWAY_SECRET: undefined,
    ENS_GATEWAY_SIGNER_KEY: undefined,
    ENS_PARENT_NAME: undefined,
    ENS_PAYMASTER_UPSTREAM: undefined,
    ENS_REGISTRAR_ADDRESS: undefined,
    ENS_RESOLVER_ADDRESSES: undefined,
    ENS_SEPOLIA_RPC_URL: undefined,
    ENS_VOUCHER_KEY: undefined,
    GOOGLE_CLASS_ID: undefined,
    GOOGLE_ISSUER_ID: undefined,
    GOOGLE_SA_EMAIL: undefined,
    GOOGLE_SA_KEY_PEM: undefined,
    SIGNER_PRIVATE_KEY: undefined,
    TURNSTILE_SECRET_KEY: undefined,
    USE_FAKE_CHAIN: undefined,
    WORLD_ACTION: undefined,
    WORLD_APP_ID: undefined,
    WORLD_RP_ID: undefined,
    WORLD_RP_SIGNING_KEY: undefined,
  }
  return { ...base, ...overrides }
}

// Announcement tests assert exact block numbers and chunk ranges, so the fake
// starts at a fixed head here rather than FakeChain's real-time default;
// pass `head` explicitly to override it.
export const fakeChain = (opts: { signer?: Hex | null; head?: number } = {}): FakeChain =>
  new FakeChain({ head: 100, ...opts })

export const appWith = (deps: AppDeps) => createApp(deps)
