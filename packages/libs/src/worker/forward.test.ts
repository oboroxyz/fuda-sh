// @vitest-environment node
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiOriginFor, forwardToApi } from './index.ts'

const COOKIES = ['fuda_operator', 'fuda_admin']
const app = new Hono()
app.all(
  '/api/*',
  async (c) =>
    await forwardToApi(c, {
      apiBaseUrl: 'https://api.example/',
      expireOnUnauthorized: COOKIES,
      token: c.req.header('x-test-token') ?? null,
    }),
)

const stubApi = (response: Response) => {
  const spy = vi.fn<typeof fetch>().mockResolvedValue(response)
  vi.stubGlobal('fetch', spy)
  return spy
}

describe(forwardToApi, () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    [{}, 'https://api.fuda.sh/health'],
    [{ API_BASE_URL: 'http://localhost:8787' }, 'http://localhost:8787/health'],
  ])('forwards without requiring a deployment variable: %j', async (bindings, expected) => {
    const spy = stubApi(Response.json({ ok: true }))
    const worker = new Hono<{ Bindings: { API_BASE_URL?: string } }>()
    worker.get(
      '/api/health',
      async (c) =>
        await forwardToApi(c, {
          apiBaseUrl: apiOriginFor(c.env.API_BASE_URL),
          expireOnUnauthorized: [],
          token: null,
        }),
    )
    const response = await worker.request('/api/health', undefined, bindings)
    expect(response.status).toBe(200)
    expect(spy.mock.calls[0]?.[0]).toBe(expected)
  })

  it("adds the session's credential and the visitor's IP, dropping the browser's own", async () => {
    const spy = stubApi(Response.json({ ok: true }))
    const res = await app.request('/api/v1/issuers/me?x=1', {
      headers: {
        authorization: 'Bearer forged',
        'cf-connecting-ip': '203.0.113.7',
        'x-real-ip': '1.1.1.1',
        'x-test-token': 'session-1',
      },
    })
    expect(res.status).toBe(200)
    const [url, init] = spy.mock.calls[0] ?? []
    expect(url).toBe('https://api.example/v1/issuers/me?x=1')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer session-1')
    // The api rate-limits by visitor: a same-zone subrequest takes its
    // CF-Connecting-IP from x-real-ip, which only the Worker sets.
    expect(new Headers(init?.headers).get('x-real-ip')).toBe('203.0.113.7')
  })

  it("passes the browser's user agent, and a pass download's file name back", async () => {
    const spy = stubApi(
      new Response('pass', {
        headers: {
          'content-disposition': 'attachment; filename="pass.pkpass"',
          'content-type': 'application/vnd.apple.pkpass',
          'x-internal': 'dropped',
        },
      }),
    )
    const res = await app.request('/api/pass/x/apple.pkpass', { headers: { 'user-agent': 'iPhone' } })
    expect(new Headers(spy.mock.calls[0]?.[1]?.headers).get('user-agent')).toBe('iPhone')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="pass.pkpass"')
    expect(res.headers.get('content-type')).toBe('application/vnd.apple.pkpass')
    expect(res.headers.get('x-internal')).toBeNull()
  })

  it('sends no Authorization header for an empty token or none', async () => {
    const spy = stubApi(Response.json({ members: [] }))
    await app.request('/api/v1/members', { headers: { 'x-test-token': '' } })
    await app.request('/api/v1/members')
    expect(new Headers(spy.mock.calls[0]?.[1]?.headers).get('authorization')).toBeNull()
    expect(new Headers(spy.mock.calls[1]?.[1]?.headers).get('authorization')).toBeNull()
  })

  it('ends the session when the api answers 401', async () => {
    stubApi(Response.json({ error: 'unauthorized' }, { status: 401 }))
    const res = await app.request('/api/v1/issuers/me', { headers: { 'x-test-token': 'stale' } })
    expect(res.status).toBe(401)
    expect(res.headers.getSetCookie().map((cookie) => cookie.split(';')[0])).toStrictEqual([
      'fuda_operator=',
      'fuda_admin=',
    ])
  })

  it('refuses a cross-origin write without calling the api', async () => {
    const spy = stubApi(Response.json({}))
    const res = await app.request('http://dash.example/api/v1/issue', {
      body: '{}',
      headers: { origin: 'https://evil.example', 'x-test-token': 'x' },
      method: 'POST',
    })
    expect(res.status).toBe(403)
    expect(spy).not.toHaveBeenCalled()
  })

  it('answers 502 when the api cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('down')))
    const res = await app.request('/api/v1/members')
    expect(res.status).toBe(502)
  })
})
