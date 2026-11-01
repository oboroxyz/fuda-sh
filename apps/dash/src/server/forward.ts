import { crossOriginWrite, forwardToApi } from '@fuda/libs/worker'
import type { Context } from 'hono'
import * as v from 'valibot'

import { readCredential, SESSION_COOKIES, startOperatorSession } from './cookies.ts'
import { sessionVersion } from './session-version.ts'

const TokenResponse = v.looseObject({ token: v.optional(v.string()) })
export const forwardDashboard = async (c: Context, apiBaseUrl: string): Promise<Response> => {
  const refused = crossOriginWrite(c)
  if (refused !== null) {
    return refused
  }
  const credential = readCredential(c)
  const version = c.req.header('x-fuda-session')
  const write = c.req.method !== 'GET' && c.req.method !== 'HEAD'
  if (
    credential !== null &&
    (write || version !== undefined) &&
    version !== (await sessionVersion(credential.token))
  ) {
    return c.json({ error: 'session_changed' }, 409)
  }
  const response = await forwardToApi(c, {
    apiBaseUrl,
    expireOnUnauthorized: SESSION_COOKIES,
    token: credential?.token ?? null,
  })
  // New issuer creation and switching can rotate the operator credential.
  // Keep it HttpOnly and return only the public operation result to the page.
  const { path } = c.req
  if (
    response.ok &&
    c.req.method === 'POST' &&
    (path === '/api/v1/issuers' || path === '/api/v1/auth/switch')
  ) {
    const parsed = v.safeParse(TokenResponse, await response.json())
    if (!parsed.success) {
      return c.json({ error: 'bad_response' }, 502)
    }
    const { token, ...body } = parsed.output
    if (token !== undefined) {
      startOperatorSession(c, token)
    }
    c.header('cache-control', 'no-store')
    return c.json(body, response.status === 201 ? 201 : 200)
  }
  return response
}
