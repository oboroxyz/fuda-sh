// @vitest-environment node
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { passkeySession, signOut } from './session-routes.ts'

const app = new Hono()
app.post('/session/passkey', async (c) => await passkeySession(c, 'https://api.example'))
app.post('/session/sign-out', async (c) => await signOut(c, 'https://api.example'))

const BODY = { flow: 'login', response: { id: 'credential' } }
const post = async (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  await app.request(`http://app.example${path}`, { body: JSON.stringify(body), headers, method: 'POST' })

describe('member session routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the session in an HttpOnly cookie and never returns the token', async () => {
    const spy = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ accountId: 'account-1', token: 'session-1' }))
    vi.stubGlobal('fetch', spy)
    const res = await post('/session/passkey', BODY)
    await expect(res.json()).resolves.toStrictEqual({ ok: true })
    expect(spy.mock.calls[0]?.[0]).toContain('/auth/member/login')
    expect(spy.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(BODY.response))
    const cookie = res.headers.getSetCookie().find((value) => value.startsWith('fuda_member='))
    expect(cookie).toContain('HttpOnly')
  })

  it('sends a new passkey to the registration route', async () => {
    const spy = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ accountId: 'a', token: 't' }))
    vi.stubGlobal('fetch', spy)
    await post('/session/passkey', { ...BODY, flow: 'register' })
    expect(spy.mock.calls[0]?.[0]).toContain('/auth/member/register')
  })

  it('refuses a flow it does not know without calling the api', async () => {
    const spy = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', spy)
    const res = await post('/session/passkey', { ...BODY, flow: 'admin' })
    expect(res.status).toBe(400)
    expect(spy).not.toHaveBeenCalled()
  })

  it('sets no cookie when the api refuses the passkey', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'bad_passkey' }, { status: 401 })),
    )
    const res = await post('/session/passkey', BODY)
    expect(res.status).toBe(401)
    expect(res.headers.getSetCookie()).toStrictEqual([])
  })

  it.each(['/session/passkey', '/session/sign-out'])(
    'refuses a cross-site POST to %s without touching cookies or the api',
    async (path) => {
      const spy = vi.fn<typeof fetch>()
      vi.stubGlobal('fetch', spy)
      const res = await post(path, BODY, { origin: 'https://evil.example' })
      expect(res.status).toBe(403)
      expect(res.headers.getSetCookie()).toStrictEqual([])
      expect(spy).not.toHaveBeenCalled()
    },
  )

  it('clears the cookie on sign-out and ends the session at the api', async () => {
    const spy = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ loggedOut: true }))
    vi.stubGlobal('fetch', spy)
    const res = await post('/session/sign-out', {}, { cookie: 'fuda_member=session-1' })
    expect(res.headers.getSetCookie()[0]).toMatch(/^fuda_member=;/u)
    expect(new Headers(spy.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer session-1')
  })
})
