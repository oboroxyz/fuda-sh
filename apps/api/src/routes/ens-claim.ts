import { asHex } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import * as v from 'valibot'
import { getAddress } from 'viem'

import { issuers } from '../db/schema.ts'
import {
  claimedEvent,
  claimConfigFrom,
  readClaimNonce,
  sepoliaClient,
  signClaimVoucher,
} from '../ens/claim.ts'
import type { ClaimConfig } from '../ens/claim.ts'
import { mirrorIssuerName } from '../ens/mirror.ts'
import { issuerEnsName } from '../ens/names.ts'
import { sponsorable } from '../ens/paymaster.ts'
import { ensNames } from '../ens/schema.ts'
import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'
import { rateLimit } from '../middleware/rate-limit.ts'

// Sponsorship requests per IP per hour. A venue claims its name once; this is a
// ceiling on abuse of a public endpoint, not a working budget.
export const PAYMASTER_BUDGET = 60

export const ensClaimRoutes = new Hono<AppEnv>()

const TxHashBody = v.object({ txHash: v.pipe(v.string(), v.regex(/^0x[0-9a-fA-F]{64}$/u)) })

// The venue behind the signed-in operator, or null when they have not created one.
const operatorIssuer = async (c: Context<AppEnv>) => {
  const { issuerId } = c.get('operator')
  if (issuerId === null) {
    return null
  }
  return (await c.get('db').select().from(issuers).where(eq(issuers.id, issuerId)).get()) ?? null
}

const claimed = async (c: Context<AppEnv>, config: ClaimConfig, handle: string) =>
  await c
    .get('db')
    .select()
    .from(ensNames)
    .where(eq(ensNames.name, issuerEnsName(handle, config.parentName)))
    .get()

// Signs the authorization the registrar checks and records the claim as pending.
// It does not send anything: the operator's own wallet submits, sponsored through
// POST /ens/paymaster (docs/specs/ens-naming.md#issuer-claim-and-renewal).
ensClaimRoutes.post('/issuers/me/ens/claim-voucher', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const config = claimConfigFrom(c.env)
  if (config === null) {
    return errorResponse(c, 'ens_not_configured', 503)
  }
  const issuer = await operatorIssuer(c)
  if (issuer === null) {
    return errorResponse(c, 'not_found', 404)
  }
  const existing = await claimed(c, config, issuer.handle)
  if (existing?.status === 'claimed') {
    return errorResponse(c, 'already_claimed', 409)
  }
  const owner = getAddress(c.get('operator').address)
  let voucher: Awaited<ReturnType<typeof signClaimVoucher>>
  try {
    // Read the nonce fresh every time: an abandoned prompt leaves the previous
    // voucher unused, and re-signing at the same nonce is what makes retrying work.
    const nonce = await readClaimNonce(config, owner)
    voucher = await signClaimVoucher(config, {
      handle: issuer.handle,
      issuer: owner,
      nonce,
      now: c.get('now')(),
    })
  } catch {
    return errorResponse(c, 'chain_error', 502)
  }
  try {
    await mirrorIssuerName(c.get('db'), {
      handle: issuer.handle,
      now: c.get('now')(),
      owner,
      parentName: config.parentName,
      status: 'voucher_issued',
    })
  } catch {
    return errorResponse(c, 'ens_persistence_failed', 503)
  }
  return jsonResponse(c, {
    chainId: sepoliaClient(config).chain.id,
    name: issuerEnsName(issuer.handle, config.parentName),
    voucher,
  })
})

// Records the claim only after the chain confirms it. An unverifiable hash leaves
// the name pending, which is recoverable; recording an unconfirmed claim is not.
ensClaimRoutes.post('/issuers/me/ens/claimed', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const config = claimConfigFrom(c.env)
  if (config === null) {
    return errorResponse(c, 'ens_not_configured', 503)
  }
  const issuer = await operatorIssuer(c)
  if (issuer === null) {
    return errorResponse(c, 'not_found', 404)
  }
  const parsed = v.safeParse(TxHashBody, await c.req.json().catch(() => null))
  const txHash = parsed.success ? asHex(parsed.output.txHash, 32) : null
  if (txHash === null) {
    return errorResponse(c, 'bad_input', 400)
  }
  const owner = getAddress(c.get('operator').address)
  let event: ReturnType<typeof claimedEvent>
  let receiptReverted = false
  try {
    const receipt = await sepoliaClient(config).getTransactionReceipt({
      hash: txHash,
    })
    receiptReverted = receipt.status === 'reverted'
    event =
      receipt.status === 'success'
        ? claimedEvent(receipt.logs, { handle: issuer.handle, issuer: owner, registrar: config.registrar })
        : null
  } catch {
    return errorResponse(c, 'chain_error', 502)
  }
  if (receiptReverted) {
    return errorResponse(c, 'claim_failed', 409)
  }
  if (event === null) {
    return errorResponse(c, 'claim_unconfirmed', 409)
  }
  try {
    await mirrorIssuerName(c.get('db'), {
      claimTxHash: txHash,
      expiry: event.expiry,
      handle: issuer.handle,
      now: c.get('now')(),
      owner,
      parentName: config.parentName,
      status: 'claimed',
    })
  } catch {
    return errorResponse(c, 'ens_persistence_failed', 503)
  }
  return jsonResponse(c, {
    claimTxHash: txHash,
    expiry: event.expiry,
    name: issuerEnsName(issuer.handle, config.parentName),
    status: 'claimed',
  })
})

const RpcId = v.union([v.string(), v.number(), v.null()])

// The ERC-7677 request shape, parsed rather than inspected: `params` is
// [userOperation, entryPoint, chainId, context] and only the first element's
// call data decides whether fuda pays.
const PaymasterBody = v.object({
  id: v.optional(RpcId, null),
  method: v.picklist(['pm_getPaymasterStubData', 'pm_getPaymasterData']),
  params: v.tupleWithRest([v.object({ callData: v.string() })], v.unknown()),
})

type RpcIdValue = v.InferOutput<typeof RpcId>

const rpcError = (id: RpcIdValue, code: number, message: string) => ({
  error: { code, message },
  id,
  jsonrpc: '2.0',
})

// The ERC-7677 endpoint the dashboard's wallet calls. It exists so the vendor key
// stays a Worker secret and so sponsorship can be restricted by destination —
// neither Alchemy nor Pimlico can express that, and their sender allowlists are
// useless here because a venue's account does not exist until it claims.
ensClaimRoutes.post('/ens/paymaster', rateLimit({ budget: PAYMASTER_BUDGET }), async (c) => {
  c.header('cache-control', 'no-store')
  const config = claimConfigFrom(c.env)
  if (config === null) {
    return errorResponse(c, 'ens_not_configured', 503)
  }
  const parsed = v.safeParse(PaymasterBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json(rpcError(null, -32_600, 'invalid request'), 400)
  }
  const { id, method, params } = parsed.output
  const [userOperation, ...rest] = params
  if (!sponsorable(userOperation.callData, config.registrar)) {
    return c.json(rpcError(id, -32_602, 'call not sponsored'), 400)
  }
  // The policy id is injected here rather than sent by the browser: Alchemy
  // requires it in `context`, and the Base Account SDK sends a bare URL.
  const forwarded = [userOperation, rest[0] ?? null, rest[1] ?? null, { policyId: config.gasPolicyId }]
  const upstream = await fetch(config.paymasterUpstream, {
    body: JSON.stringify({ id, jsonrpc: '2.0', method, params: forwarded }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  }).catch(() => null)
  if (upstream === null) {
    return c.json(rpcError(id, -32_603, 'paymaster unavailable'), 502)
  }
  const answer = v.parse(v.unknown(), await upstream.json())
  return c.json(answer, upstream.ok ? 200 : 502)
})
