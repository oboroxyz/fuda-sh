import { normalizeNonce, SignInChallengeBody, SignInVerifyBody } from '@fuda/sdk'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import * as v from 'valibot'
import type { Hex } from 'viem'

import { createSession, deleteSession } from '../auth/session.ts'
import type { SessionAudience } from '../auth/session.ts'
import { consumeSignIn, mintSignIn, signInMessage } from '../auth/sign-in.ts'
import { ChainError } from '../chain/client.ts'
import { issuers } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { issuerView } from '../issuers/views.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { memberAuth } from '../middleware/member-auth.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'

export const authRoutes = new Hono<AppEnv>()

authRoutes.use('/auth/*', async (c, next) => {
  c.header('cache-control', 'no-store')
  await next()
})

// Addresses are stored lower-cased: a Base Account may report its address in
// any case, and the issuer lookup below must not depend on it.
const lowerAddress = (raw: string): Hex => `0x${raw.slice(2).toLowerCase()}`

const challenge = (audience: SessionAudience) => async (c: Context<AppEnv>) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(SignInChallengeBody, body)
  if (!parsed.success) {
    return errorResponse(c, 'bad_address', 400)
  }
  return jsonResponse(
    c,
    await mintSignIn(c.get('db'), lowerAddress(parsed.output.address), audience, c.get('now')()),
  )
}

authRoutes.post('/auth/challenge', challenge('operator'))
authRoutes.post('/auth/member/challenge', challenge('member'))

// Verification order: nonce (one-time, bound to the address, inside the TTL) →
// signature (EOA, ERC-1271 or ERC-6492 through the chain client) → session.
// A wrong signature burns the nonce, as the gate does.
const verify = (audience: SessionAudience) => async (c: Context<AppEnv>) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(SignInVerifyBody, body)
  const nonce = parsed.success ? normalizeNonce(parsed.output.nonce) : null
  if (!parsed.success || nonce === null) {
    return errorResponse(c, 'bad_input', 400)
  }
  const db = c.get('db')
  const now = c.get('now')()
  const address = lowerAddress(parsed.output.address)
  if (!(await consumeSignIn(db, { address, audience, nonce, now }))) {
    return errorResponse(c, 'bad_challenge', 401)
  }
  const message = signInMessage(audience, nonce)
  // Annotated (not cast): SIGNATURE_RE guarantees the 0x prefix.
  const signature: Hex = `0x${parsed.output.signature.slice(2)}`
  let valid: boolean
  try {
    valid = await c.get('chain').verifyMessage({ address, message, signature })
  } catch (error) {
    if (error instanceof ChainError) {
      return errorResponse(c, 'chain_error', 502)
    }
    throw error
  }
  if (!valid) {
    return errorResponse(c, 'bad_signature', 401)
  }
  if (audience === 'member') {
    const token = await createSession(db, { address, audience, issuerId: null, now })
    return jsonResponse(c, { address, token })
  }
  const issuer = await db.select().from(issuers).where(eq(issuers.operatorAddress, address)).get()
  const token = await createSession(db, { address, audience, issuerId: issuer?.id ?? null, now })
  return jsonResponse(c, {
    issuer: issuer === undefined ? null : issuerView(issuer, c.env.API_BASE_URL),
    token,
  })
}

authRoutes.post('/auth/verify', verify('operator'))
authRoutes.post('/auth/member/verify', verify('member'))

authRoutes.get('/auth/member/me', memberAuth(), (c) => jsonResponse(c, { address: c.get('member').address }))

authRoutes.post('/auth/member/logout', memberAuth(), async (c) => {
  await deleteSession(c.get('db'), c.get('member').tokenHash)
  return jsonResponse(c, { loggedOut: true })
})

authRoutes.post('/auth/logout', operatorAuth(), async (c) => {
  await deleteSession(c.get('db'), c.get('operator').tokenHash)
  return jsonResponse(c, { loggedOut: true })
})
