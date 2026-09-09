import type { IssuerView } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { cards, challenges, issuers, members, sessions } from '../src/db/schema.ts'
import { ensNames } from '../src/ens/schema.ts'
import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain, testEnv } from './env.ts'
import { NOW, other } from './fixtures.ts'
import { getJson, postJson, signIn } from './operator.ts'

const venue = { brandColor: '#6F4320', handle: 'coffee', name: 'Coffee', tagline: 'Original tagline' }
const profile = { brandColor: '#5cf794', name: '  New Coffee  ', tagline: '' }

const update = async (
  app: ReturnType<typeof appWith>,
  bindings: Bindings,
  body: unknown,
  token = '',
): Promise<Response> =>
  await app.request(
    '/v1/issuers/me',
    {
      body: JSON.stringify(body),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      method: 'PUT',
    },
    bindings,
  )

describe('venue profile updates', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(ensNames)
    await db.delete(members)
    await db.delete(sessions)
    await db.delete(challenges)
    await db.delete(cards)
    await db.delete(issuers)
  })

  it('saves display fields without changing the venue identity and exposes them on the public page', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = testEnv()
    const { token } = await signIn(app, bindings)
    const created = await postJson(app, bindings, '/v1/issuers', venue, token)
    const original = await created.json<{ issuer: IssuerView }>()

    const result = await update(app, bindings, profile, token)
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    await expect(result.json()).resolves.toStrictEqual({
      issuer: { ...original.issuer, brandColor: '#5CF794', name: 'New Coffee', tagline: '' },
    })
    const publicPage = await getJson(app, bindings, '/v1/issuers/coffee')
    await expect(publicPage.json()).resolves.toMatchObject({
      brandColor: '#5CF794',
      handle: 'coffee',
      name: 'New Coffee',
      tagline: '',
    })
  })

  it.each([
    { name: '' },
    { name: '   ' },
    { name: 'a'.repeat(81) },
    { tagline: 'a'.repeat(121) },
    { brandColor: 'red' },
    { handle: 'new-handle' },
    { id: 'another-issuer' },
    { operatorAddress: other.address },
    { logoPrefix: 'another-logo' },
  ])('rejects invalid or immutable fields: %j', async (invalid) => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = testEnv()
    const { token } = await signIn(app, bindings)
    await postJson(app, bindings, '/v1/issuers', venue, token)

    const result = await update(app, bindings, { ...profile, ...invalid }, token)
    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toStrictEqual({ error: 'bad_input' })
    const current = await getJson(app, bindings, '/v1/issuers/coffee')
    await expect(current.json()).resolves.toMatchObject(venue)
  })

  it('requires an operator session with its own registered venue', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = testEnv()
    const { token } = await signIn(app, bindings)
    await postJson(app, bindings, '/v1/issuers', venue, token)

    const anonymous = await update(app, bindings, profile)
    expect(anonymous.status).toBe(401)
    const outsider = await signIn(app, bindings, other)
    const missingVenue = await update(app, bindings, profile, outsider.token)
    expect(missingVenue.status).toBe(404)
    const current = await getJson(app, bindings, '/v1/issuers/coffee')
    await expect(current.json()).resolves.toMatchObject(venue)
  })
})
