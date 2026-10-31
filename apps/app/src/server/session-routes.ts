import {
  apiHeaders,
  clearCookie,
  crossOriginWrite,
  readCookie,
  SESSION_MAX_AGE_SECONDS,
  setSessionCookie,
} from '@fuda/libs/worker'
import type { Hex, MemberSignInResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Context } from 'hono'
import * as v from 'valibot'

import { MEMBER_COOKIE } from '../cookie-names.ts'

const HexString = v.pipe(v.string(), v.regex(/^0x[0-9a-fA-F]*$/u))
export const VerifyBody = v.object({ address: HexString, nonce: HexString, signature: HexString })

// The browser's half of sign-in is the wallet signature; this half spends it at
// the api and keeps the member session token in a cookie the browser cannot read.
export const verifyMember = async (c: Context, apiBaseUrl: string): Promise<Response> => {
  const refused = crossOriginWrite(c)
  if (refused !== null) {
    return refused
  }
  const parsed = v.safeParse(VerifyBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'bad_input' }, 400)
  }
  const result = await apiFetch<MemberSignInResponse>(apiBaseUrl, '/auth/member/verify', {
    body: JSON.stringify(parsed.output),
    headers: apiHeaders(c, null),
    method: 'POST',
  })
  if (!result.ok) {
    // SAFETY: a non-zero status came from the api's own response, so it is a valid HTTP status.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Hono types the status as a literal union
    return c.json({ error: result.error }, (result.status === 0 ? 502 : result.status) as 400)
  }
  setSessionCookie(c, MEMBER_COOKIE, result.body.token, SESSION_MAX_AGE_SECONDS)
  return c.json({ address: result.body.address } satisfies { address: Hex })
}

// Local sign-out always succeeds; ending the session at the api is best effort.
export const signOut = async (c: Context, apiBaseUrl: string): Promise<Response> => {
  const refused = crossOriginWrite(c)
  if (refused !== null) {
    return refused
  }
  const token = readCookie(c, MEMBER_COOKIE)
  clearCookie(c, MEMBER_COOKIE)
  if (token !== null && token !== '') {
    await apiFetch(apiBaseUrl, '/auth/member/logout', {
      body: '{}',
      headers: apiHeaders(c, token),
      method: 'POST',
    })
  }
  return c.json({ ok: true })
}
