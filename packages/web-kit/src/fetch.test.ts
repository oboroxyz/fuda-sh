import { describe, expect, it, vi } from 'vitest'

import { apiFetch } from './fetch.ts'

const stubFetch = (impl: (url: string, init?: RequestInit) => Response) => {
  const spy = vi.fn<(url: string, init?: RequestInit) => Response>(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}
const json = (body: unknown, status: number): Response => Response.json(body, { status })

describe(apiFetch, () => {
  it('returns the JSON body on 2xx and sends the bearer token when given', async () => {
    const spy = stubFetch(() => json({ ok: 1 }, 200))
    const result = await apiFetch<{ ok: number }>('http://api', '/x', { method: 'GET', token: 't' })
    expect(result).toStrictEqual({ body: { ok: 1 }, ok: true })
    expect(spy.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: 'Bearer t' })
  })

  it('maps a 4xx error body to a non-network failure with its status', async () => {
    stubFetch(() => json({ error: 'bad_uid' }, 400))
    await expect(apiFetch('http://api', '/x')).resolves.toStrictEqual({
      error: 'bad_uid',
      network: false,
      ok: false,
      status: 400,
    })
  })

  it('treats 5xx, a transport failure and a non-JSON body as their own cases', async () => {
    stubFetch(() => new Response('<html>', { status: 502 }))
    await expect(apiFetch('http://api', '/x')).resolves.toMatchObject({
      network: true,
      ok: false,
      status: 502,
    })
    stubFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    await expect(apiFetch('http://api', '/x')).resolves.toMatchObject({ network: true, ok: false, status: 0 })
    stubFetch(() => new Response('<html>', { status: 200 }))
    await expect(apiFetch('http://api', '/x')).resolves.toMatchObject({
      error: 'bad_response',
      network: false,
      ok: false,
      status: 200,
    })
  })

  it('joins a base with a trailing slash to the path without doubling it', async () => {
    const spy = stubFetch(() => json({}, 200))
    await apiFetch('http://api/', '/x')
    expect(spy.mock.calls[0]?.[0]).toBe('http://api/x')
  })
})
