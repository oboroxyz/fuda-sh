import { normalizeNonce, SignInChallengeBody, SignInVerifyBody } from '@fuda/sdk'
import type { OperatorMeResponse, OperatorSignInResponse, SignInResponse } from '@fuda/sdk'
import * as v from 'valibot'
import type { Hex } from 'viem'
import { defineHandler } from 'void'

import type { OperatorPrincipal } from '../auth/principal.ts'
import { createOperatorSession, deleteSession } from '../auth/session.ts'
import { consumeSignIn, mintSignIn, signInMessage } from '../auth/sign-in.ts'
import { ChainError } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { issuersOwnedBy } from '../issuers/queries.ts'
import { issuerView } from '../issuers/views.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'
import { passkeyCeremonies } from './passkey-ceremonies.ts'

// A principal may own several issuers; a new session starts on the oldest, and the
// dashboard switches with POST /auth/switch.
const startOperatorSession = async (
  db: Db,
  principal: OperatorPrincipal,
  apiBaseUrl: string,
  now: number,
): Promise<SignInResponse> => {
  const [issuer] = await issuersOwnedBy(db, principal)
  return {
    issuer: issuer === undefined ? null : issuerView(issuer, apiBaseUrl),
    token: await createOperatorSession(db, { issuerId: issuer?.id ?? null, now, principal }),
  }
}

// Addresses are stored lower-cased: a Base Account may report its address in
// any case, and the issuer lookup below must not depend on it.
const lowerAddress = (raw: string): Hex => `0x${raw.slice(2).toLowerCase()}`

export const postV1AuthChallenge = defineHandler(async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(SignInChallengeBody, body)
  if (!parsed.success) {
    return errorResponse(c, 'bad_address', 400)
  }
  return jsonResponse(c, await mintSignIn(c.get('db'), lowerAddress(parsed.output.address), c.get('now')()))
})

// Verification order: nonce (one-time, bound to the address, inside the TTL) →
// signature (EOA, ERC-1271 or ERC-6492 through the chain client) → session.
// A wrong signature burns the nonce, as the gate does.
export const postV1AuthVerify = defineHandler(async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(SignInVerifyBody, body)
  const nonce = parsed.success ? normalizeNonce(parsed.output.nonce) : null
  if (!parsed.success || nonce === null) {
    return errorResponse(c, 'bad_input', 400)
  }
  const db = c.get('db')
  const now = c.get('now')()
  const address = lowerAddress(parsed.output.address)
  if (!(await consumeSignIn(db, { address, nonce, now }))) {
    return errorResponse(c, 'bad_challenge', 401)
  }
  const message = signInMessage(nonce)
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
  const session = await startOperatorSession(db, { address, kind: 'wallet' }, c.env.API_BASE_URL, now)
  return jsonResponse(c, session)
})

export const postV1AuthLogout = defineHandler(operatorAuth(), async (c) => {
  await deleteSession(c.get('db'), c.get('operator').tokenHash)
  return jsonResponse(c, { loggedOut: true })
})

const ceremonies = passkeyCeremonies({
  accountOf: (c) => {
    const { principal } = c.get('operator')
    return principal.kind === 'account' ? principal.accountId : null
  },
  auth: operatorAuth,
  signedIn: async (c, accountId) => {
    const session = await startOperatorSession(
      c.get('db'),
      { accountId, kind: 'account' },
      c.env.API_BASE_URL,
      c.get('now')(),
    )
    return jsonResponse(c, { ...session, accountId } satisfies OperatorSignInResponse)
  },
})

export const postV1AuthOperatorRegisterOptions = ceremonies.registerOptions
export const postV1AuthOperatorRegister = ceremonies.register
export const postV1AuthOperatorLoginOptions = ceremonies.loginOptions
export const postV1AuthOperatorLogin = ceremonies.login
export const getV1AuthOperatorPasskeys = ceremonies.list
export const postV1AuthOperatorPasskeysOptions = ceremonies.addOptions
export const postV1AuthOperatorPasskeysAuthorizeOptions = ceremonies.authorizeAddOptions
export const postV1AuthOperatorPasskeys = ceremonies.add
export const deleteV1AuthOperatorPasskey = ceremonies.remove

export const getV1AuthOperatorMe = defineHandler(operatorAuth(), (c) => {
  const { principal } = c.get('operator')
  const body: OperatorMeResponse =
    principal.kind === 'account'
      ? { accountId: principal.accountId, address: null }
      : { accountId: null, address: principal.address }
  return jsonResponse(c, body)
})
