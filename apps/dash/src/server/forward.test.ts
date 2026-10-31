import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { forwardToApi } from './forward.ts'

const app = new Hono()
app.all('/api/*', async (c) => await forwardToApi(c, 'https://api.example/'))

const stubApi = (response: Response) => {
  const spy = vi.fn<typeof fetch>().mockResolvedValue(response)
  vi.stubGlobal('fetch', spy)
  return spy
}

describe(forwardToApi, () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('adds the cookie credential and drops a browser-sent authorization header', async () => {
    const spy = stubApi(Response.json({ ok: true }))
    const res = await app.request('/api/v1/issuers/me?x=1', {
      headers: { authorization: 'Bearer forged', cookie: 'fuda_operator=session-1' },
    })
    expect(res.status).toBe(200)
    const [url, init] = spy.mock.calls[0] ?? []
    expect(url).toBe('https://api.example/v1/issuers/me?x=1')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer session-1')
  })

  it('forwards the admin token, and no header at all for an empty one', async () => {
    const spy = stubApi(Response.json({ members: [] }))
    await app.request('/api/v1/members', { headers: { cookie: 'fuda_admin=deploy-token' } })
    expect(new Headers(spy.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer deploy-token')
    await app.request('/api/v1/members', { headers: { cookie: 'fuda_admin=' } })
    expect(new Headers(spy.mock.calls[1]?.[1]?.headers).get('authorization')).toBeNull()
  })

  it('ends the session when the api answers 401', async () => {
    stubApi(Response.json({ error: 'unauthorized' }, { status: 401 }))
    const res = await app.request('/api/v1/issuers/me', { headers: { cookie: 'fuda_operator=stale' } })
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
      headers: { cookie: 'fuda_admin=x', origin: 'https://evil.example' },
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
