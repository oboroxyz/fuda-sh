import type { CardUpdateResponse, ImageSetSpec, PublicVenue } from '@fuda/sdk'
import { IMAGE_SETS } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { cards, challenges, issuers, members, sessions } from '../src/db/schema.ts'
import { appWith, fakeChain, testEnv } from './env.ts'
import { NOW } from './fixtures.ts'
import { CARD_INPUT, registerVenueWithCard, signIn } from './operator.ts'

const bindings = () => testEnv({ API_BASE_URL: 'https://api.test' })
const db = () => getDb({ DB: env.DB })
const form = (kind: 'artwork' | 'poster') => {
  const body = new FormData()
  const spec: ImageSetSpec = IMAGE_SETS[kind]
  for (const [variant, size] of Object.entries(spec.variants)) {
    const bytes = new Uint8Array(64)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const view = new DataView(bytes.buffer)
    view.setUint32(12, 0x49_48_44_52)
    view.setUint32(16, size.width)
    view.setUint32(20, size.height)
    body.set(variant, new Blob([bytes], { type: 'image/png' }), `${variant}.png`)
  }
  return body
}

const setup = async (kind: 'artwork' | 'poster') => {
  const app = appWith({ chain: fakeChain(), now: () => NOW })
  const { token } = await signIn(app, bindings())
  await registerVenueWithCard(app, bindings(), CARD_INPUT, token)
  const card = await db().select().from(cards).get()
  if (card === undefined) {
    throw new Error('Card missing')
  }
  return {
    app,
    headers: { authorization: `Bearer ${token}` },
    path: `/v1/issuers/me/cards/${card.id}/${kind}`,
  }
}

describe.each(['artwork', 'poster'] as const)('Card %s', (kind) => {
  const urlField = kind === 'artwork' ? 'artworkUrl' : 'posterUrl'
  const variant = kind === 'artwork' ? 'strip3x' : 'poster3x'
  beforeEach(async () => {
    await db().delete(members)
    await db().delete(sessions)
    await db().delete(challenges)
    await db().delete(cards)
    await db().delete(issuers)
  })

  it('saves and serves the set, then stops serving after removal', async () => {
    const { app, headers, path } = await setup(kind)
    const uploaded = await app.request(path, { body: form(kind), headers, method: 'PUT' }, bindings())
    const { card } = await uploaded.json<CardUpdateResponse>()
    expect(card[urlField]).toMatch(
      new RegExp(`^https://api.test/assets/${kind}/[0-9a-f-]{36}/${variant}$`, 'u'),
    )
    const venue = await app.request(`/v1/issuers/${CARD_INPUT.handle}`, {}, bindings())
    const publicView = await venue.json<PublicVenue>()

    expect(Object.keys(publicView.cards[0] ?? {})).not.toContain('posterUrl')
    const url = new URL(card[urlField] ?? '').pathname
    const image = await app.request(url, {}, bindings())
    expect([
      image.status,
      image.headers.get('content-type'),
      image.headers.get('cache-control'),
    ]).toStrictEqual([200, 'image/png', 'public, max-age=31536000, immutable'])
    const cached = await app.request(
      url,
      { headers: { 'if-none-match': image.headers.get('etag') ?? '' } },
      bindings(),
    )
    expect(cached.status).toBe(304)
    const removed = await app.request(path, { headers, method: 'DELETE' }, bindings())
    const removal = await removed.json<CardUpdateResponse>()

    const withoutArtwork = await app.request(`/v1/issuers/${CARD_INPUT.handle}`, {}, bindings())
    const removedView = await withoutArtwork.json<PublicVenue>()
    const gone = await app.request(url, {}, bindings())
    expect([
      kind === 'artwork' ? publicView.cards[0]?.artworkUrl : null,
      removal.card[urlField],
      removedView.cards[0]?.artworkUrl,
      gone.status,
    ]).toStrictEqual([kind === 'artwork' ? card[urlField] : null, null, null, 404])
  })

  it('requires ownership, a complete set, and a media bucket', async () => {
    const { app, headers, path } = await setup(kind)
    const anonymous = await app.request(path, { body: form(kind), method: 'PUT' }, bindings())
    const anonymousDelete = await app.request(path, { method: 'DELETE' }, bindings())
    await db().insert(issuers).values({
      brandColor: '#112233',
      createdAt: NOW,
      handle: 'foreign',
      id: 'foreign-issuer',
      name: 'Foreign',
      operatorAddress: '0x1111111111111111111111111111111111111111',
      tagline: '',
    })
    await db().insert(cards).values({
      category: 'membership',
      createdAt: NOW,
      id: 'foreign',
      issuerId: 'foreign-issuer',
      title: 'Foreign',
    })
    const foreignPath = path.replace(/cards\/[^/]+/u, 'cards/foreign')
    const foreign = await app.request(foreignPath, { body: form(kind), headers, method: 'PUT' }, bindings())
    const foreignDelete = await app.request(foreignPath, { headers, method: 'DELETE' }, bindings())
    const bad = form(kind)
    bad.delete(kind === 'artwork' ? 'strip2x' : 'poster2x')
    const invalid = await app.request(path, { body: bad, headers, method: 'PUT' }, bindings())
    const unconfigured = await app.request(
      path,
      { body: form(kind), headers, method: 'PUT' },
      testEnv({ MEDIA_BUCKET: undefined }),
    )
    expect([
      anonymous.status,
      anonymousDelete.status,
      foreign.status,
      foreignDelete.status,
      invalid.status,
      unconfigured.status,
    ]).toStrictEqual([401, 401, 404, 404, 400, 501])
  })
})
