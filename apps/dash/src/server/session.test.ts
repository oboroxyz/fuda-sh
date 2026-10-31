import type { IssuerMeResponse } from '@fuda/sdk'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveSession } from './session.ts'
import type { SessionOutcome } from './session.ts'

const resolve = async (path: string, cookie = ''): Promise<{ outcome: SessionOutcome; res: Response }> => {
  let outcome: SessionOutcome | undefined
  const app = new Hono()
  app.all('*', async (c) => {
    outcome = await resolveSession(c, 'https://api.example')
    return c.text('ok')
  })
  const res = await app.request(path, { headers: { cookie } })
  if (outcome === undefined) {
    throw new Error('the handler did not run')
  }
  return { outcome, res }
}

const me: IssuerMeResponse = { cards: [], ens: null, issuer: null, publicUrl: null }

describe(resolveSession, () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the language and theme preferences, defaulting both', async () => {
    const { outcome } = await resolve('/signin', 'fuda_locale=ja; fuda_theme=dark')
    expect(outcome.shared).toMatchObject({ locale: 'ja', surface: null, theme: 'dark' })
    const defaults = await resolve('/signin', 'fuda_locale=xx')
    expect(defaults.outcome.shared).toMatchObject({ locale: 'en', theme: 'system' })
  })

  it("loads an operator session's venue and routes it to its home", async () => {
    const spy = vi.fn<typeof fetch>().mockResolvedValue(Response.json(me))
    vi.stubGlobal('fetch', spy)
    const { outcome } = await resolve('/', 'fuda_operator=session-1')
    expect(outcome).toMatchObject({ redirect: '/start', token: 'session-1' })
    expect(outcome.shared).toMatchObject({ operator: me, surface: 'operator' })
    expect(new Headers(spy.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer session-1')
  })

  it('ends a session the api no longer accepts and says why on sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 401 })))
    const { outcome, res } = await resolve('/cards', 'fuda_operator=stale')
    expect(outcome.redirect).toBe('/signin?reason=unauthorized')
    expect(res.headers.getSetCookie().some((cookie) => cookie.startsWith('fuda_operator=;'))).toBe(true)
  })

  it('keeps a session it could not check and asks for a retry instead', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('down', { status: 503 })))
    const { outcome } = await resolve('/cards', 'fuda_operator=session-1')
    expect(outcome).toMatchObject({ redirect: null, token: 'session-1' })
    expect(outcome.shared).toMatchObject({ restoreFailed: true, surface: 'operator' })
  })

  it('leaves api, session-route and asset requests to their own handlers', async () => {
    const spy = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', spy)
    const outcomes = await Promise.all(
      ['/api/v1/members', '/session/admin', '/favicon.svg'].map(async (path) => {
        const { outcome } = await resolve(path, 'fuda_operator=session-1')
        return outcome.redirect
      }),
    )
    expect(outcomes).toStrictEqual([null, null, null])
    expect(spy).not.toHaveBeenCalled()
  })

  it('takes an admin cookie as the admin surface without calling the api', async () => {
    const spy = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', spy)
    const { outcome } = await resolve('/cards', 'fuda_admin=')
    expect(outcome).toMatchObject({ redirect: '/', token: '' })
    expect(spy).not.toHaveBeenCalled()
  })
})
