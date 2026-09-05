import { createApp } from './app.ts'
import type { ChainClient } from './chain/client.ts'
import { FakeChain } from './chain/fake-chain.ts'
import { createViemChain } from './chain/viem-chain.ts'
import { SCHEMA_STRINGS, schemaUid } from './eas/schemas.ts'
import type { Bindings } from './env.ts'

export type DevBindings = Bindings & { USE_FAKE_CHAIN?: string }

type FakeChainSignal = Pick<DevBindings, 'BASE_RPC_URL' | 'SIGNER_PRIVATE_KEY' | 'USE_FAKE_CHAIN'>

// Explicit local-dev opt-in only: never silently fake in production. A signer
// or RPC binding always wins over USE_FAKE_CHAIN, so a half-configured
// deployment fails closed onto the real chain rather than a fake one.
export const isFakeChainEnabled = (env: FakeChainSignal): boolean =>
  env.USE_FAKE_CHAIN === '1' && env.SIGNER_PRIVATE_KEY === undefined && env.BASE_RPC_URL === undefined

// One FakeChain per isolate so `wrangler dev` keeps issued rights across requests.
let devChain: FakeChain | null = null

const createDevChain = (): FakeChain => {
  const chain = new FakeChain()
  const uid = chain.seedRootDelegation(schemaUid(SCHEMA_STRINGS.issuerDelegation))
  // oxlint-disable-next-line no-console -- one-time dev bootstrap hint, printed once per isolate
  console.warn(
    `[fuda-api] USE_FAKE_CHAIN=1: seeded root delegation. Set ISSUER_ADDRESS=${chain.signerAddress() ?? ''} and DELEGATION_UID=${uid} in wrangler.jsonc env.dev.vars.`,
  )
  return chain
}

// Exported for tests: proves the FakeChain/viem-chain choice without needing a
// network call — `createViemChain` never touches the network at construction.
export const buildChain = (env: DevBindings): ChainClient => {
  if (isFakeChainEnabled(env)) {
    devChain ??= createDevChain()
    return devChain
  }
  return createViemChain(env)
}

// Production entry. The chain client is built per request from bindings; only
// the explicit local-dev opt-in above ever swaps in an in-memory chain.
export default {
  fetch: (request: Request, env: DevBindings, ctx: ExecutionContext): Response | Promise<Response> =>
    createApp({ chain: buildChain(env) }).fetch(request, env, ctx),
}
