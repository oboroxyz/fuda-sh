import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiFetch, setSessionVersion } from './session-request.ts'

describe('dashboard request session context', () => {
  afterEach(() => {
    setSessionVersion(null)
    vi.unstubAllGlobals()
  })

  it('carries the page identifier without a browser-visible bearer credential', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetcher)
    setSessionVersion('page-version')
    await apiFetch('/api', '/issuers/me', { body: '{}', method: 'PUT' })
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers)
    expect(headers.get('x-fuda-session')).toBe('page-version')
    expect(headers.has('authorization')).toBe(false)
  })

  it('reloads a stale page after the Worker rejects its session context', async () => {
    const reload = vi.fn<() => void>()
    vi.stubGlobal('window', { location: { reload } })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'session_changed' }, { status: 409 })),
    )
    const result = await apiFetch('/api', '/issuers/me')
    expect(result).toMatchObject({ error: 'session_changed', ok: false, status: 409 })
    expect(reload).toHaveBeenCalledOnce()
  })
})
