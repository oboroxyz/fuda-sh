// @vitest-environment node
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { signOut, verifyMember } from './session-routes.ts'

const app = new Hono()
app.post('/session/member', async (c) => await verifyMember(c, 'https://api.example'))
app.post('/session/sign-out', async (c) => await signOut(c, 'https://api.example'))

const HEX = `0x${'ab'.repeat(20)}`
const post = async (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  await app.request(`http://app.example${path}`, { body: JSON.stringify(body), headers, method: 'POST' })

describe('member session routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the verified token in an HttpOnly cookie and returns only the address', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ address: HEX, token: 'session-1' })),
    )
    const res = await post('/session/member', { address: HEX, nonce: HEX, signature: HEX })
    await expect(res.json()).resolves.toStrictEqual({ address: HEX })
    const cookie = res.headers.getSetCookie().find((value) => value.startsWith('fuda_member=session-1'))
    expect(cookie).toContain('HttpOnly')
  })

  it.each(['/session/member', '/session/sign-out'])(
    'refuses a cross-site POST to %s without touching cookies or the api',
    async (path) => {
      const spy = vi.fn<typeof fetch>()
      vi.stubGlobal('fetch', spy)
      const res = await post(
        path,
        { address: HEX, nonce: HEX, signature: HEX },
        { origin: 'https://evil.example' },
      )
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
