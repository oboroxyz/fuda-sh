import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { cards, challenges, issuers, members, sessions } from '../src/db/schema.ts'
import { ensNames } from '../src/ens/schema.ts'
import type { Bindings } from '../src/env.ts'
import type { SiteverifyFetch } from '../src/turnstile/siteverify.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRoot } from './fixtures.ts'
import { CARD_INPUT, registerVenueWithCard, signIn } from './operator.ts'

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const setup = async () => {
  const chain = fakeChain({ signer: ROOT })
  const del = seedRoot(chain)
  const app = appWith({ chain, now: () => NOW })
  const bindings = configuredEnv(del, {
    API_BASE_URL: 'https://api.test',
    PUBLIC_BASE_URL: 'https://fuda.test',
  })
  const { token } = await signIn(app, bindings)
  await registerVenueWithCard(app, bindings, CARD_INPUT, token)
  return { app, bindings: { ...bindings, TURNSTILE_SECRET_KEY: 'turnstile-secret' } satisfies Bindings }
}

const claim = async (
  app: Awaited<ReturnType<typeof setup>>['app'],
  bindings: Bindings,
  body?: Record<string, string>,
): Promise<Response> =>
  await app.request(
    '/v1/issuers/wassie-coffee/stamp/issue',
    {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'CF-Connecting-IP': '203.0.113.7' },
      method: 'POST',
    },
    bindings,
  )

const siteverify = (answer: Response | Error) =>
  vi.fn<SiteverifyFetch>(
    async () => await (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)),
  )

const placesReserved = async (): Promise<number> => {
  const rows = await getDb({ DB: env.DB }).select().from(members)
  return rows.length
}

describe('the claim bot check', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(ensNames)
    await db.delete(members)
    await db.delete(sessions)
    await db.delete(challenges)
    await db.delete(cards)
    await db.delete(issuers)
    return () => {
      vi.unstubAllGlobals()
    }
  })

  it('issues the pass when Siteverify accepts the token, and sends it the visitor ip', async () => {
    const { app, bindings } = await setup()
    const fetcher = siteverify(Response.json({ action: 'claim', success: true }))
    vi.stubGlobal('fetch', fetcher)
    const res = await claim(app, bindings, { source: 'flyer', turnstileToken: 'good-token' })
    expect(res.status).toBe(200)
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(url).toBe(SITEVERIFY)
    expect(init?.body.toString()).toBe('remoteip=203.0.113.7&response=good-token&secret=turnstile-secret')
    await expect(placesReserved()).resolves.toBe(1)
  })

  it('keeps the token when the source label is mangled', async () => {
    const { app, bindings } = await setup()
    vi.stubGlobal('fetch', siteverify(Response.json({ action: 'claim', success: true })))
    const res = await claim(app, bindings, { source: 'NOT A LABEL!', turnstileToken: 'good-token' })
    expect(res.status).toBe(200)
  })

  it('answers 403 bot_check_failed for a rejected token and reserves no place', async () => {
    const { app, bindings } = await setup()
    vi.stubGlobal(
      'fetch',
      siteverify(Response.json({ 'error-codes': ['timeout-or-duplicate'], success: false })),
    )
    const res = await claim(app, bindings, { turnstileToken: 'used-token' })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toStrictEqual({ error: 'bot_check_failed' })
    await expect(placesReserved()).resolves.toBe(0)
  })

  it('answers 403 bot_check_failed without a token, or a body, and never asks Siteverify', async () => {
    const { app, bindings } = await setup()
    const fetcher = siteverify(Response.json({ action: 'claim', success: true }))
    vi.stubGlobal('fetch', fetcher)
    const bodies: (Record<string, string> | undefined)[] = [undefined, {}, { source: 'flyer' }]
    for (const body of bodies) {
      // oxlint-disable-next-line no-await-in-loop -- sequential requests share one rate budget
      const res = await claim(app, bindings, body)
      expect(res.status).toBe(403)
      // oxlint-disable-next-line no-await-in-loop -- see above
      await expect(res.json()).resolves.toStrictEqual({ error: 'bot_check_failed' })
    }
    expect(fetcher).not.toHaveBeenCalled()
    await expect(placesReserved()).resolves.toBe(0)
  })

  it('fails closed with 503 bot_check_unavailable when Siteverify is down, and reserves no place', async () => {
    const { app, bindings } = await setup()
    vi.stubGlobal('fetch', siteverify(new Error('network down')))
    const down = await claim(app, bindings, { turnstileToken: 'good-token' })
    expect(down.status).toBe(503)
    await expect(down.json()).resolves.toStrictEqual({ error: 'bot_check_unavailable' })
    vi.stubGlobal('fetch', siteverify(new Response('bad gateway', { status: 502 })))
    const bad = await claim(app, bindings, { turnstileToken: 'good-token' })
    expect(bad.status).toBe(503)
    await expect(placesReserved()).resolves.toBe(0)
  })

  it('skips the check when the deployment has no secret', async () => {
    const { app, bindings } = await setup()
    const fetcher = siteverify(new Error('must not be called'))
    vi.stubGlobal('fetch', fetcher)
    const res = await claim(app, { ...bindings, TURNSTILE_SECRET_KEY: undefined })
    expect(res.status).toBe(200)
    const empty = await claim(app, { ...bindings, TURNSTILE_SECRET_KEY: '' })
    expect(empty.status).toBe(200)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not check a card that is not there', async () => {
    const { app, bindings } = await setup()
    const fetcher = siteverify(new Error('must not be called'))
    vi.stubGlobal('fetch', fetcher)
    const res = await app.request(
      '/v1/issuers/nobody/stamp/issue',
      { headers: { 'CF-Connecting-IP': '203.0.113.7' }, method: 'POST' },
      bindings,
    )
    expect(res.status).toBe(404)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('requires Turnstile on an unauthenticated Sensitive claim before reserving capacity', async () => {
    const { app, bindings } = await setup()
    await getDb({ DB: env.DB }).update(cards).set({ capacity: 1, identity: 'sensitive', record: 'offchain' })
    const fetcher = siteverify(Response.json({ action: 'claim', success: true }))
    vi.stubGlobal('fetch', fetcher)
    const holderAddress = `0x${'11'.repeat(20)}`
    const rejected = await claim(app, bindings, { holderAddress })
    expect(rejected.status).toBe(403)
    await expect(rejected.json()).resolves.toStrictEqual({ error: 'bot_check_failed' })
    expect(fetcher).not.toHaveBeenCalled()
    const [before] = await getDb({ DB: env.DB }).select({ reserved: cards.reserved }).from(cards)
    expect(before?.reserved).toBe(0)
    const accepted = await claim(app, bindings, { holderAddress, turnstileToken: 'good-token' })
    const [after] = await getDb({ DB: env.DB }).select({ reserved: cards.reserved }).from(cards)
    expect({
      calls: fetcher.mock.calls.length,
      reserved: after?.reserved,
      status: accepted.status,
    }).toStrictEqual({ calls: 1, reserved: 1, status: 200 })
  })
})
