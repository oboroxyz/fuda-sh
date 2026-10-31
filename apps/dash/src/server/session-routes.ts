import type { IssuerView, SignInResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Context } from 'hono'
import * as v from 'valibot'

import { endSession, readCredential, startAdminSession, startOperatorSession } from './cookies.ts'

const HexString = v.pipe(v.string(), v.regex(/^0x[0-9a-fA-F]*$/u))
export const VerifyBody = v.object({ address: HexString, nonce: HexString, signature: HexString })
export const AdminBody = v.object({ token: v.string() })

// The browser's half of sign-in is the wallet signature; this half spends it at
// the api and keeps the session token in a cookie the browser cannot read.
export const verifyOperator = async (c: Context, apiBaseUrl: string): Promise<Response> => {
  const parsed = v.safeParse(VerifyBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'bad_input' }, 400)
  }
  const result = await apiFetch<SignInResponse>(apiBaseUrl, '/auth/verify', {
    body: JSON.stringify(parsed.output),
    method: 'POST',
  })
  if (!result.ok) {
    // SAFETY: a non-zero status came from the api's own response, so it is a valid HTTP status.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Hono types the status as a literal union
    return c.json({ error: result.error }, (result.status === 0 ? 502 : result.status) as 400)
  }
  startOperatorSession(c, result.body.token)
  return c.json({ issuer: result.body.issuer } satisfies { issuer: IssuerView | null })
}

// The admin token is not checked here: an api with ADMIN_TOKEN unset accepts
// any value, and a wrong one shows as the first admin read's 401.
export const startAdmin = async (c: Context): Promise<Response> => {
  const parsed = v.safeParse(AdminBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'bad_input' }, 400)
  }
  startAdminSession(c, parsed.output.token.trim())
  return c.json({ ok: true })
}

// Local sign-out always succeeds; ending the operator session at the api is
// best effort, as it was when the browser held the token.
export const signOut = async (c: Context, apiBaseUrl: string): Promise<Response> => {
  const credential = readCredential(c)
  endSession(c)
  if (credential?.kind === 'operator') {
    await apiFetch(apiBaseUrl, '/auth/logout', { body: '{}', method: 'POST', token: credential.token })
  }
  return c.json({ ok: true })
}
