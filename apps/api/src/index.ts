import { createApp } from './app.ts'
import { attendanceHook } from './attendance/attendance-hook.ts'
import type { ChainClient } from './chain/client.ts'
import { DEV_DELEGATION_UID, FakeChain } from './chain/fake-chain.ts'
import { createViemChain } from './chain/viem-chain.ts'
import { getDb } from './db/client.ts'
import { parseSchemaSets, SCHEMA_STRINGS, schemaUid } from './eas/schemas.ts'
import type { SchemaSets } from './eas/schemas.ts'
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
  const uid = chain.seedRootDelegation(schemaUid(SCHEMA_STRINGS.issuerDelegation), DEV_DELEGATION_UID)
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

const EMPTY_SETS: SchemaSets = { attendance: [], entitlement: [], issuerDelegation: [] }

// Announced once per isolate, not per request.
let schemaWarned = false

// A malformed EAS_SCHEMAS binding must not take the door down: the routes
// already answer 502 for it, and the hook simply has no schema to attest under.
// Exported for tests.
export const schemaSetsOf = (env: Pick<DevBindings, 'EAS_SCHEMAS'>): SchemaSets => {
  try {
    return parseSchemaSets(env.EAS_SCHEMAS)
  } catch {
    if (!schemaWarned) {
      schemaWarned = true
      // oxlint-disable-next-line no-console -- a malformed binding degrades every chain route; the log line is the only trace
      console.warn('[fuda-api] EAS_SCHEMAS is malformed: no schema is accepted and Attendance is disabled.')
    }
    return EMPTY_SETS
  }
}

// Production entry. The chain client and the Attendance hook are built per
// request from bindings; only the explicit local-dev opt-in above ever swaps in
// an in-memory chain.
export default {
  fetch: (request: Request, env: DevBindings, ctx: ExecutionContext): Response | Promise<Response> => {
    const chain = buildChain(env)
    const onAdmit = attendanceHook({ chain, db: getDb(env), sets: schemaSetsOf(env) })
    return createApp({ chain, onAdmit }).fetch(request, env, ctx)
  },
}
