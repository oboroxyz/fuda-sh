import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { passkeySession, signOut, startAdmin, verifyOperator } from './session-routes.ts'

const app = new Hono()
app.post('/session/operator', async (c) => await verifyOperator(c, 'https://api.example'))
app.post('/session/passkey', async (c) => await passkeySession(c, 'https://api.example'))
app.post('/session/admin', async (c) => await startAdmin(c))
app.post('/session/sign-out', async (c) => await signOut(c, 'https://api.example'))

const HEX = `0x${'ab'.repeat(20)}`
const post = async (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  await app.request(`http://dash.example${path}`, { body: JSON.stringify(body), headers, method: 'POST' })
const cookieNames = (res: Response): string[] =>
  res.headers.getSetCookie().map((cookie) => cookie.split(';')[0] ?? '')

describe('session routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the verified session token in an HttpOnly cookie and returns only the venue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ issuer: null, token: 'session-1' })),
    )
    const res = await post('/session/operator', { address: HEX, nonce: HEX, signature: HEX })
    await expect(res.json()).resolves.toStrictEqual({ issuer: null })
    const cookie = res.headers.getSetCookie().find((value) => value.startsWith('fuda_operator='))
    expect(cookie).toContain('HttpOnly')
    expect(cookieNames(res)).toContain('fuda_operator=session-1')
  })

  it('keeps a passkey session in the HttpOnly cookie and returns only the venue', async () => {
    const api = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ accountId: 'a', issuer: null, token: 'session-2' }))
    vi.stubGlobal('fetch', api)
    const res = await post('/session/passkey', { flow: 'register', response: { id: 'x' } })
    await expect(res.json()).resolves.toStrictEqual({ issuer: null })
    expect(cookieNames(res)).toContain('fuda_operator=session-2')
    expect(api.mock.calls[0]?.[0]).toBe('https://api.example/v1/auth/operator/register')
    expect(api.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ id: 'x' }))
  })

  it('refuses a passkey session from another site before it reaches the api', async () => {
    const api = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', api)
    const res = await post(
      '/session/passkey',
      { flow: 'login', response: {} },
      { origin: 'https://evil.example' },
    )
    expect(res.status).toBe(403)
    expect(api).not.toHaveBeenCalled()
  })

  it('refuses a passkey flow it does not know', async () => {
    const api = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', api)
    const res = await post('/session/passkey', { flow: 'add', response: {} })
    expect(res.status).toBe(400)
    expect(api).not.toHaveBeenCalled()
  })

  it("passes the api's refusal through without setting a cookie", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'bad_signature' }, { status: 401 })),
    )
    const res = await post('/session/operator', { address: HEX, nonce: HEX, signature: HEX })
    expect(res.status).toBe(401)
    expect(cookieNames(res).some((name) => name.startsWith('fuda_operator=s'))).toBe(false)
  })

  it.each([
    ['/session/operator', { address: HEX, nonce: HEX, signature: HEX }],
    ['/session/admin', { token: 'x' }],
    ['/session/sign-out', {}],
  ])('refuses a cross-site POST to %s without touching cookies or the api', async (path, body) => {
    const spy = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', spy)
    const res = await post(path, body, { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(res.headers.getSetCookie()).toStrictEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('replaces an operator session with the admin token, and clears both on sign-out', async () => {
    const admin = await post('/session/admin', { token: ' deploy ' }, { origin: 'http://dash.example' })
    expect(cookieNames(admin)).toStrictEqual(['fuda_operator=', 'fuda_admin=deploy'])
    const spy = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ loggedOut: true }))
    vi.stubGlobal('fetch', spy)
    const out = await post('/session/sign-out', {}, { cookie: 'fuda_operator=session-1' })
    expect(cookieNames(out)).toStrictEqual(['fuda_operator=', 'fuda_admin='])
    expect(new Headers(spy.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer session-1')
  })
})
