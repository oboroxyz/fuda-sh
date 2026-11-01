// @vitest-environment node
import type { PublicVenue } from '@fuda/sdk'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadVenue, venuePageOf } from './venue.ts'

const APP = 'http://app.example'
const venue = (cards: string[], defaultCardSlug: string | null = null): PublicVenue =>
  ({
    badges: [],
    brandColor: '#112233',
    cards: cards.map((slug) => ({ claimable: true, slug, title: slug })),
    defaultCardSlug,
    handle: 'coffee',
    logoUrl: null,
    name: 'Coffee',
    tagline: '',
  }) as unknown as PublicVenue

const load = async (path: string) => {
  const app = new Hono()
  app.get('*', async (c) => {
    const result = await loadVenue(c, new URL(`${APP}${path}`), 'https://api.example', APP)
    return result instanceof Response ? result : c.json(result)
  })
  return await app.request(`${APP}/venue/x`)
}

describe(venuePageOf, () => {
  it('reads the venue page a `/@<handle>` URL names', () => {
    expect(venuePageOf(new URL(`${APP}/@coffee`), APP)).toStrictEqual({ handle: 'coffee', kind: 'entry' })
    expect(venuePageOf(new URL(`${APP}/@coffee/home`), APP)).toStrictEqual({ handle: 'coffee', kind: 'home' })
    expect(venuePageOf(new URL(`${APP}/@coffee/club`), APP)).toStrictEqual({
      handle: 'coffee',
      kind: 'card',
      slug: 'club',
    })
    expect(venuePageOf(new URL(`${APP}/rights`), APP)).toBeNull()
  })
})

describe(loadVenue, () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("opens a venue's only card directly, keeping the query", async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(venue(['club']))))
    const res = await load('/@coffee?ref=poster')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/@coffee/club?ref=poster')
  })

  it('offers the choice when asked for every card, or when there are several', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(venue(['club']))))
    const all = await load('/@coffee?cards=all')
    expect(all.status).toBe(200)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(venue(['club', 'vip']))))
    const res = await load('/@coffee')
    await expect(res.json()).resolves.toMatchObject({ page: { kind: 'entry' }, venue: { ok: true } })
  })

  it('passes an unknown venue to the page to explain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'not_found' }, { status: 404 })),
    )
    const res = await load('/@nobody/club')
    await expect(res.json()).resolves.toMatchObject({ venue: { ok: false, status: 404 } })
  })
})
