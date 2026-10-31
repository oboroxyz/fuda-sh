import type { Context } from 'hono'

import { expiredSessionCookies, readCredential } from './cookies.ts'
import { crossOriginWrite } from './origin.ts'

// Headers the browser's request may pass on to the api. Everything else,
// including any Authorization the browser sends, is dropped: the credential is
// the cookie's.
const PASSED_REQUEST_HEADERS = ['accept', 'accept-language', 'content-type']
const PASSED_RESPONSE_HEADERS = ['cache-control', 'content-type', 'retry-after']

const apiUrl = (base: string, request: URL, prefix: string): string =>
  `${base.replace(/\/$/u, '')}${request.pathname.slice(prefix.length)}${request.search}`

// `/api/*` answers as the api would, with the session's Bearer token added. An
// api 401 also ends the session here, so the browser has one way to learn its
// session is gone: the next page request lands on sign-in.
export const forwardToApi = async (c: Context, apiBaseUrl: string, prefix = '/api'): Promise<Response> => {
  const refused = crossOriginWrite(c)
  if (refused !== null) {
    return refused
  }
  const { method } = c.req
  const self = new URL(c.req.url)
  const headers = new Headers()
  for (const name of PASSED_REQUEST_HEADERS) {
    const value = c.req.header(name)
    if (value !== undefined) {
      headers.set(name, value)
    }
  }
  const credential = readCredential(c)
  // An empty admin token is a session on an api without ADMIN_TOKEN, which
  // reads no header at all.
  if (credential !== null && credential.token !== '') {
    headers.set('authorization', `Bearer ${credential.token}`)
  }
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const init: RequestInit & { duplex?: 'half' } = { headers, method, redirect: 'manual' }
  if (hasBody) {
    // A streamed request body needs half-duplex in workerd and undici alike.
    init.body = c.req.raw.body
    init.duplex = 'half'
  }
  let res: Response
  try {
    res = await fetch(apiUrl(apiBaseUrl, self, prefix), init)
  } catch {
    return c.json({ error: 'api_unreachable' }, 502)
  }
  const passed = new Headers()
  for (const name of PASSED_RESPONSE_HEADERS) {
    const value = res.headers.get(name)
    if (value !== null) {
      passed.set(name, value)
    }
  }
  if (res.status === 401 && credential !== null) {
    for (const cookie of expiredSessionCookies()) {
      passed.append('set-cookie', cookie)
    }
  }
  return new Response(res.body, { headers: passed, status: res.status })
}
