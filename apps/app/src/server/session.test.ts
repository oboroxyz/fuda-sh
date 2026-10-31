// @vitest-environment node
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveSession } from './session.ts'
import type { SessionOutcome } from './session.ts'

const APP = 'http://app.example'

const resolve = async (
  path: string,
  cookie = '',
  origin = APP,
): Promise<{ outcome: SessionOutcome; res: Response }> => {
  let outcome: SessionOutcome | undefined
  const app = new Hono()
  app.all('*', async (c) => {
    outcome = await resolveSession(c, new URL(c.req.url), 'https://api.example', APP)
    return c.text('ok')
  })
  const res = await app.request(`${origin}${path}`, { headers: { cookie } })
  if (outcome === undefined) {
    throw new Error('the handler did not run')
  }
  return { outcome, res }
}

const ADDRESS = `0x${'ab'.repeat(20)}`

describe(resolveSession, () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends a signed-out member page to sign-in, keeping where it was going', async () => {
    const { outcome } = await resolve('/rights?uid=x')
    expect(outcome.redirect).toBe('/signin?return=%2Frights%3Fuid%3Dx')
  })

  it("checks a member session and shares the member's address", async () => {
    const spy = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ address: ADDRESS }))
    vi.stubGlobal('fetch', spy)
    const { outcome } = await resolve('/settings', 'fuda_member=session-1; fuda_locale=ja')
    expect(outcome).toMatchObject({ redirect: null, token: 'session-1' })
    expect(outcome.shared).toMatchObject({ address: ADDRESS, locale: 'ja', signedIn: true })
    expect(new Headers(spy.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer session-1')
  })

  it('ends a session the api no longer accepts and asks for sign-in again', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 401 })))
    const { outcome, res } = await resolve('/rights', 'fuda_member=stale')
    expect(outcome.redirect).toBe('/signin?return=%2Frights')
    expect(res.headers.getSetCookie().some((cookie) => cookie.startsWith('fuda_member=;'))).toBe(true)
  })

  it('keeps a session it could not check and asks for a retry instead', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('down', { status: 503 })))
    const { outcome } = await resolve('/rights', 'fuda_member=session-1')
    expect(outcome).toMatchObject({ redirect: null, token: 'session-1' })
    expect(outcome.shared.restoreFailed).toBe(true)
  })

  it('sends a signed-in visit to sign-in on to its validated destination', async () => {
    const { outcome } = await resolve('/signin?return=%2Fsettings', 'fuda_member=session-1')
    expect(outcome.redirect).toBe('/settings')
    const unsafe = await resolve('/signin?return=https%3A%2F%2Fevil.example', 'fuda_member=session-1')
    expect(unsafe.outcome.redirect).toBe('/rights')
  })

  it('serves public pages without reading the session, and sends unknown paths to the top', async () => {
    const spy = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', spy)
    const top = await resolve('/', 'fuda_member=session-1')
    const card = await resolve('/@coffee', 'fuda_member=session-1')
    const unknown = await resolve('/nowhere')
    expect([top.outcome.redirect, card.outcome.redirect, unknown.outcome.redirect]).toStrictEqual([
      null,
      null,
      '/',
    ])
    expect(spy).not.toHaveBeenCalled()
  })

  it('moves member and card pages from another host to the app origin', async () => {
    const { outcome } = await resolve('/@coffee/membership?x=1', '', 'http://other.example')
    expect(outcome.redirect).toBe(`${APP}/@coffee/membership?x=1`)
  })
})
