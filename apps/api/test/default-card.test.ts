import type { IssuerView, PublicVenue } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { cards, challenges, issuers, members, sessions } from '../src/db/schema.ts'
import { ensNames } from '../src/ens/schema.ts'
import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain, testEnv } from './env.ts'
import { NOW, other } from './fixtures.ts'
import { CARD_INPUT, getJson, registerVenueWithCard, signIn } from './operator.ts'

type App = ReturnType<typeof appWith>

const putJson = async (
  app: App,
  bindings: Bindings,
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> => {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token !== undefined) {
    headers.set('authorization', `Bearer ${token}`)
  }
  return await app.request(path, { body: JSON.stringify(body), headers, method: 'PUT' }, bindings)
}

const setup = async () => {
  const app = appWith({ chain: fakeChain(), now: () => NOW })
  const bindings = testEnv({ ENS_PARENT_NAME: 'fuda.eth' })
  const { token } = await signIn(app, bindings)
  await registerVenueWithCard(app, bindings, CARD_INPUT, token)
  return { app, bindings, token }
}

describe('PUT /issuers/me/default-card', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(ensNames)
    await db.delete(members)
    await db.delete(sessions)
    await db.delete(challenges)
    await db.delete(cards)
    await db.delete(issuers)
  })

  it('sets an owned card and returns the current issuer with no-store', async () => {
    const { app, bindings, token } = await setup()
    const initial = await getJson(app, bindings, '/v1/issuers/me', token)
    await expect(initial.json()).resolves.toMatchObject({ issuer: { defaultCardSlug: null } })

    const set = await putJson(app, bindings, '/v1/issuers/me/default-card', { slug: 'stamp' }, token)
    expect(set.status).toBe(200)
    expect(set.headers.get('cache-control')).toBe('no-store')
    await expect(set.json<{ issuer: IssuerView }>()).resolves.toMatchObject({
      issuer: { defaultCardSlug: 'stamp', handle: 'wassie-coffee' },
    })
    const current = await getJson(app, bindings, '/v1/issuers/me', token)
    await expect(current.json()).resolves.toMatchObject({ issuer: { defaultCardSlug: 'stamp' } })
  })

  it('clears the current default Card', async () => {
    const { app, bindings, token } = await setup()
    await putJson(app, bindings, '/v1/issuers/me/default-card', { slug: 'stamp' }, token)

    const clear = await putJson(app, bindings, '/v1/issuers/me/default-card', { slug: null }, token)
    expect(clear.status).toBe(200)
    expect(clear.headers.get('cache-control')).toBe('no-store')
    await expect(clear.json()).resolves.toMatchObject({ issuer: { defaultCardSlug: null } })
    const current = await getJson(app, bindings, '/v1/issuers/me', token)
    await expect(current.json()).resolves.toMatchObject({ issuer: { defaultCardSlug: null } })
  })

  it('rejects unknown and foreign card slugs without changing the current default', async () => {
    const { app, bindings, token } = await setup()
    await putJson(app, bindings, '/v1/issuers/me/default-card', { slug: 'stamp' }, token)
    const foreign = await signIn(app, bindings, other)
    await registerVenueWithCard(
      app,
      bindings,
      {
        ...CARD_INPUT,
        card: { ...CARD_INPUT.card, slug: 'foreign' },
        handle: 'other-coffee',
        name: 'Other Coffee',
      },
      foreign.token,
    )

    for (const slug of ['foreign', 'unknown']) {
      // oxlint-disable-next-line no-await-in-loop -- each rejected write must be observed independently
      const response = await putJson(app, bindings, '/v1/issuers/me/default-card', { slug }, token)
      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBe('no-store')
      // oxlint-disable-next-line no-await-in-loop -- response bodies are consumed sequentially with their requests
      await expect(response.json()).resolves.toStrictEqual({ error: 'not_found' })
    }
    const current = await getJson(app, bindings, '/v1/issuers/me', token)
    await expect(current.json()).resolves.toMatchObject({ issuer: { defaultCardSlug: 'stamp' } })
  })

  it('requires an operator session and an exact request body', async () => {
    const { app, bindings, token } = await setup()
    const anonymous = await putJson(app, bindings, '/v1/issuers/me/default-card', { slug: 'stamp' })
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get('cache-control')).toBe('no-store')

    for (const body of [{}, { slug: 1 }, { extra: true, slug: 'stamp' }]) {
      // oxlint-disable-next-line no-await-in-loop -- each invalid contract shape gets its own response
      const invalid = await putJson(app, bindings, '/v1/issuers/me/default-card', body, token)
      expect(invalid.status).toBe(400)
      // oxlint-disable-next-line no-await-in-loop -- response bodies are consumed sequentially with their requests
      await expect(invalid.json()).resolves.toStrictEqual({ error: 'bad_input' })
    }
  })

  it('preserves the default when saving the venue profile and emits it publicly', async () => {
    const { app, bindings, token } = await setup()
    await putJson(app, bindings, '/v1/issuers/me/default-card', { slug: 'stamp' }, token)

    const profile = await putJson(
      app,
      bindings,
      '/v1/issuers/me',
      { brandColor: '#123456', name: 'New Coffee', tagline: 'New tagline' },
      token,
    )
    await expect(profile.json<{ issuer: IssuerView }>()).resolves.toMatchObject({
      issuer: { defaultCardSlug: 'stamp', name: 'New Coffee' },
    })
    const publicResponse = await getJson(app, bindings, '/v1/issuers/wassie-coffee')
    await expect(publicResponse.json<PublicVenue>()).resolves.toMatchObject({
      defaultCardSlug: 'stamp',
      name: 'New Coffee',
    })
  })

  it('allows a pre-existing home card to become the default', async () => {
    const { app, bindings, token } = await setup()
    await env.DB.prepare('UPDATE cards SET slug = ?1 WHERE slug = ?2').bind('home', 'stamp').run()

    const response = await putJson(app, bindings, '/v1/issuers/me/default-card', { slug: 'home' }, token)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ issuer: { defaultCardSlug: 'home' } })
  })
})
