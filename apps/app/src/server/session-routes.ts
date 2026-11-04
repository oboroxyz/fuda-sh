import {
  apiHeaders,
  clearCookie,
  crossOriginWrite,
  readCookie,
  SESSION_MAX_AGE_SECONDS,
  setSessionCookie,
} from '@fuda/libs/worker'
import type { MemberSignInResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Context } from 'hono'
import * as v from 'valibot'

import { MEMBER_COOKIE } from '../cookie-names.ts'

const PasskeySessionBody = v.object({
  flow: v.picklist(['login', 'register']),
  response: v.unknown(),
})

// The browser's ceremony answer goes to the api here, so the session token it returns
// stays in an HttpOnly cookie and never reaches the browser.
export const passkeySession = async (c: Context, apiBaseUrl: string): Promise<Response> => {
  const refused = crossOriginWrite(c)
  if (refused !== null) {
    return refused
  }
  const parsed = v.safeParse(PasskeySessionBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'bad_input' }, 400)
  }
  const result = await apiFetch<MemberSignInResponse>(apiBaseUrl, `/auth/member/${parsed.output.flow}`, {
    body: JSON.stringify(parsed.output.response),
    headers: apiHeaders(c, null),
    method: 'POST',
  })
  if (!result.ok) {
    return c.json(
      { error: result.error },
      result.status === 401 || result.status === 400 ? result.status : 502,
    )
  }
  setSessionCookie(c, MEMBER_COOKIE, result.body.token, SESSION_MAX_AGE_SECONDS)
  return c.json({ ok: true })
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
