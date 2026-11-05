import {
  apiHeaders,
  clearCookie,
  crossOriginWrite,
  readCookie,
  SESSION_MAX_AGE_SECONDS,
  setSessionCookie,
  spendPasskey,
} from '@fuda/libs/worker'
import type { MemberSignInResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Context } from 'hono'

import { MEMBER_COOKIE } from '../cookie-names.ts'

// The browser's ceremony answer goes to the api here, so the session token it returns
// stays in an HttpOnly cookie and never reaches the browser.
export const passkeySession = async (c: Context, apiBaseUrl: string): Promise<Response> => {
  const result = await spendPasskey<MemberSignInResponse>(c, apiBaseUrl, 'member')
  if (!result.ok) {
    return result.response
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
