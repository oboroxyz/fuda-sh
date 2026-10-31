import type { ApiHeaders } from '@fuda/sdk/http'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

// The server half every fuda frontend shares: each frontend Worker is the
// browser's only backend, holds the session in an HttpOnly cookie and calls
// the api on the browser's behalf (docs/adr/0010-void-pages-and-frontend-workers.md).

// A write from another site's page is refused before it reaches the api or
// touches a cookie. SameSite=Lax keeps the cookie off such a request, but a
// route that sets a session cookie needs this too: without it any page could
// sign the browser in to an account of its choosing (login CSRF). A request
// with no Origin (not from a browser page) is left alone.
export const crossOriginWrite = (c: Context): Response | null => {
  const origin = c.req.header('origin')
  if (c.req.method === 'GET' || origin === undefined || origin === new URL(c.req.url).origin) {
    return null
  }
  return c.json({ error: 'forbidden_origin' }, 403)
}

// The headers a Worker adds to its api call. The api rate-limits by
// CF-Connecting-IP, and on a same-zone subrequest Cloudflare takes that from
// `x-real-ip`; without it every visitor would share the Worker's one budget.
// An empty token is a session too (an api without ADMIN_TOKEN) and sends no
// Authorization header at all.
export const apiHeaders = (c: Context, token: string | null): ApiHeaders => {
  const headers: ApiHeaders = {}
  const ip = c.req.header('cf-connecting-ip')
  if (ip !== undefined && ip !== '') {
    headers['x-real-ip'] = ip
  }
  if (token !== null && token !== '') {
    headers.authorization = `Bearer ${token}`
  }
  return headers
}

// Headers the browser's request may pass on to the api. Everything else,
// including any Authorization or x-real-ip the browser sends, is dropped.
const PASSED_REQUEST_HEADERS = ['accept', 'accept-language', 'content-type']
// Content-Disposition carries a pass download's file name.
const PASSED_RESPONSE_HEADERS = ['cache-control', 'content-disposition', 'content-type', 'retry-after']

export interface ForwardOptions {
  apiBaseUrl: string
  // The session cookies to expire when the api answers 401 to a credential.
  expireOnUnauthorized: readonly string[]
  // The path prefix the browser calls, removed before the api path.
  prefix?: string
  token: string | null
}

// `<prefix>/*` answers as the api would, with the session's credential added.
// An api 401 to a credential also ends the session, so the browser has one way
// to learn it is gone: the next page request lands on sign-in.
export const forwardToApi = async (c: Context, options: ForwardOptions): Promise<Response> => {
  const refused = crossOriginWrite(c)
  if (refused !== null) {
    return refused
  }
  const { method } = c.req
  const self = new URL(c.req.url)
  const headers = new Headers(apiHeaders(c, options.token))
  for (const name of PASSED_REQUEST_HEADERS) {
    const value = c.req.header(name)
    if (value !== undefined) {
      headers.set(name, value)
    }
  }
  const init: RequestInit & { duplex?: 'half' } = { headers, method, redirect: 'manual' }
  if (method !== 'GET' && method !== 'HEAD') {
    // A streamed request body needs half-duplex in workerd and undici alike.
    init.body = c.req.raw.body
    init.duplex = 'half'
  }
  const prefix = options.prefix ?? '/api'
  const target = `${options.apiBaseUrl.replace(/\/$/u, '')}${self.pathname.slice(prefix.length)}${self.search}`
  let res: Response
  try {
    res = await fetch(target, init)
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
  if (res.status === 401 && options.token !== null) {
    for (const name of options.expireOnUnauthorized) {
      passed.append('set-cookie', `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`)
    }
  }
  return new Response(res.body, { headers: passed, status: res.status })
}

const secure = (c: Context): boolean => new URL(c.req.url).protocol === 'https:'

// A session cookie the browser cannot read. Without `maxAge` it ends with the
// browser session; `Secure` everywhere but plain-http local development.
export const setSessionCookie = (c: Context, name: string, value: string, maxAge?: number): void => {
  const options: Parameters<typeof setCookie>[3] = {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: secure(c),
  }
  if (maxAge !== undefined) {
    options.maxAge = maxAge
  }
  setCookie(c, name, value, options)
}

export const clearCookie = (c: Context, name: string): void => {
  deleteCookie(c, name, { path: '/' })
}

export const readCookie = (c: Context, name: string): string | null => getCookie(c, name) ?? null

// The api's session lifetime (apps/api/src/auth/session.ts).
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
