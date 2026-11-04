import { apiFetch } from '@fuda/sdk/http'
import type { ApiHeaders } from '@fuda/sdk/http'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import * as v from 'valibot'

// The server half every fuda frontend shares: each frontend Worker is the
// browser's only backend, holds the session in an HttpOnly cookie and calls
// the api on the browser's behalf (docs/adr/0010-void-pages-and-frontend-workers.md).

// Static-assets-only Workers cannot receive variables before their first
// code deployment. Keep the hosted api usable without a binding; local dev
// and alternate deployments can still provide API_BASE_URL explicitly.
export const apiOriginFor = (override: string | undefined): string => override ?? 'https://api.fuda.sh'

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

// The browser's half of a sign-in is proof it holds a credential; a Worker spends it at
// the api. On success the caller keeps the session token in a cookie the browser
// cannot read; any other outcome is already the response to send.
export type SpentSignIn<T> = { body: T; ok: true } | { ok: false; response: Response }

const spendSignIn = async <T>(
  c: Context,
  apiBaseUrl: string,
  path: string,
  body: string,
): Promise<SpentSignIn<T>> => {
  const result = await apiFetch<T>(apiBaseUrl, path, {
    body,
    headers: apiHeaders(c, null),
    method: 'POST',
  })
  if (!result.ok) {
    // SAFETY: a non-zero status came from the api's own response, so it is a valid HTTP status.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Hono types the status as a literal union
    const status = (result.status === 0 ? 502 : result.status) as 400
    return { ok: false, response: c.json({ error: result.error }, status) }
  }
  return { body: result.body, ok: true }
}

const HexString = v.pipe(v.string(), v.regex(/^0x[0-9a-fA-F]*$/u))
const WalletSignature = v.object({ address: HexString, nonce: HexString, signature: HexString })

// A session route's body: refused before it reaches the api if another site's page
// sent it, or if it does not parse.
const sameSiteBody = async <S extends v.GenericSchema>(
  c: Context,
  schema: S,
): Promise<{ ok: true; value: v.InferOutput<S> } | { ok: false; response: Response }> => {
  const refused = crossOriginWrite(c)
  if (refused !== null) {
    return { ok: false, response: refused }
  }
  const parsed = v.safeParse(schema, await c.req.json().catch(() => null))
  return parsed.success
    ? { ok: true, value: parsed.output }
    : { ok: false, response: c.json({ error: 'bad_input' }, 400) }
}

export const spendWalletSignature = async <T>(
  c: Context,
  apiBaseUrl: string,
  path: string,
): Promise<SpentSignIn<T>> => {
  const body = await sameSiteBody(c, WalletSignature)
  return body.ok ? await spendSignIn<T>(c, apiBaseUrl, path, JSON.stringify(body.value)) : body
}

const PasskeySessionBody = v.object({
  flow: v.picklist(['login', 'register']),
  response: v.unknown(),
})

export const spendPasskey = async <T>(
  c: Context,
  apiBaseUrl: string,
  audience: 'member' | 'operator',
): Promise<SpentSignIn<T>> => {
  const body = await sameSiteBody(c, PasskeySessionBody)
  return body.ok
    ? await spendSignIn<T>(
        c,
        apiBaseUrl,
        `/auth/${audience}/${body.value.flow}`,
        JSON.stringify(body.value.response),
      )
    : body
}

// Headers the browser's request may pass on to the api (the user agent picks a
// pass's wallet). Everything else, including any Authorization or x-real-ip the
// browser sends, is dropped.
const PASSED_REQUEST_HEADERS = ['accept', 'accept-language', 'content-type', 'user-agent']
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
