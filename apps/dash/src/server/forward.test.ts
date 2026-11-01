import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { forwardDashboard } from './forward.ts'
import { sessionVersion } from './session-version.ts'

const app = new Hono()
app.all('/api/*', async (c) => await forwardDashboard(c, 'https://api.example'))
const request = async (path: string, token: string, version: string | null): Promise<Response> => {
  const headers = new Headers({ cookie: `fuda_operator=${token}` })
  if (version !== null) {
    headers.set('x-fuda-session', version)
  }
  return await app.request(`http://dash.example/api/v1${path}`, { body: '{}', headers, method: 'POST' })
}

describe('dashboard session forwarding', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['/issuers/me', '/auth/switch', '/issuers'])(
    'refuses a stale tab at %s before any upstream write',
    async (path) => {
      const fetcher = vi.fn<typeof fetch>()
      vi.stubGlobal('fetch', fetcher)
      const response = await request(path, 'new-session', await sessionVersion('old-session'))
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toStrictEqual({ error: 'session_changed' })
      expect(fetcher).not.toHaveBeenCalled()
      expect(response.headers.getSetCookie()).toStrictEqual([])
    },
  )

  it('requires a page session identifier for a credentialed write', async () => {
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetcher)
    const response = await request('/issuers/me', 'current-session', null)
    expect(response.status).toBe(409)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    ['/auth/switch', 200],
    ['/issuers', 201],
  ])('keeps the rotated token HttpOnly for %s', async (path, status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ operator: { issuer: null }, token: 'rotated-session' }, { status }))
    vi.stubGlobal('fetch', fetcher)
    const response = await request(path, 'current-session', await sessionVersion('current-session'))
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toStrictEqual({ operator: { issuer: null } })
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith('fuda_operator=rotated-session;') && cookie.includes('HttpOnly')),
    ).toBe(true)
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer current-session',
    )
  })
})
