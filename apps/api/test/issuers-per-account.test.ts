import type {
  AuthorizePreviewResponse,
  ConnectCardsResponse,
  IssuerMeResponse,
  OwnedIssuersResponse,
  TokenResponse,
} from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { pkceChallenge } from '../src/connected-apps/store.ts'
import { getDb } from '../src/db/client.ts'
import {
  cards,
  challenges,
  connectedAppRedirects,
  connectedApps,
  issuers,
  oauthCodes,
  oauthTokens,
  rateLimits,
  sessions,
} from '../src/db/schema.ts'
import { appWith, fakeChain, testEnv } from './env.ts'
import { other } from './fixtures.ts'
import { CARD_INPUT, getJson, postJson, SECOND_CARD, signIn } from './operator.ts'

// docs/adr/0009-several-issuers-per-account.md — one account, several issuers,
// each with its own cards, and a session acting for one at a time.

const bindings = () => testEnv()
const db = () => getDb({ DB: env.DB })
let clock = 1000
const app = appWith({ chain: fakeChain(), now: () => clock })

const { card: COFFEE_CARD, ...COFFEE } = CARD_INPUT
const BAR = { ...COFFEE, handle: 'wassie-bar', name: 'Wassie Bar' }

const clearTables = async (): Promise<void> => {
  const database = db()
  await database.delete(oauthTokens)
  await database.delete(oauthCodes)
  await database.delete(connectedAppRedirects)
  await database.delete(connectedApps)
  await database.delete(rateLimits)
  await database.delete(sessions)
  await database.delete(challenges)
  await database.delete(cards)
  await database.delete(issuers)
}

const bodyOf = async <T>(pending: Promise<Response> | Response): Promise<T> => {
  const res = await pending
  return await res.json<T>()
}

const me = async (token: string): Promise<IssuerMeResponse> =>
  await bodyOf<IssuerMeResponse>(getJson(app, bindings(), '/v1/issuers/me', token))

const switchTo = async (token: string, issuerId: string): Promise<Response> =>
  await postJson(app, bindings(), '/v1/issuers/switch', { issuerId }, token)

// An account with two issuers: Coffee (with its stamp card) first, then Bar
// (with a ticket), the session ending on Bar.
const twoIssuers = async (): Promise<{ token: string; coffee: string; bar: string }> => {
  const { token } = await signIn(app, bindings())
  await postJson(app, bindings(), '/v1/issuers', COFFEE, token)
  await postJson(app, bindings(), '/v1/issuers/cards', COFFEE_CARD, token)
  clock += 1
  const created = await postJson(app, bindings(), '/v1/issuers', BAR, token)
  expect(created.status).toBe(201)
  await postJson(app, bindings(), '/v1/issuers/cards', SECOND_CARD, token)
  const owned = await bodyOf<OwnedIssuersResponse>(getJson(app, bindings(), '/v1/issuers/owned', token))
  const [coffee, bar] = owned.issuers.map((issuer) => issuer.id)
  return { bar: bar ?? '', coffee: coffee ?? '', token }
}

describe('several issuers per account', () => {
  beforeEach(async () => {
    clock = 1000
    await clearTables()
  })
  afterEach(clearTables)

  it('creates a second issuer, lists both and acts for the newest', async () => {
    const { bar, token } = await twoIssuers()
    const owned = await bodyOf<OwnedIssuersResponse>(getJson(app, bindings(), '/v1/issuers/owned', token))
    const current = await me(token)
    expect({
      active: owned.activeIssuerId,
      cards: current.cards.map((card) => card.slug),
      handles: owned.issuers.map((issuer) => issuer.handle),
      me: current.issuer?.handle,
    }).toStrictEqual({
      active: bar,
      cards: ['gig'],
      handles: ['wassie-coffee', 'wassie-bar'],
      me: 'wassie-bar',
    })
  })

  it('switches between them, each with only its own cards', async () => {
    const { bar, coffee, token } = await twoIssuers()
    const toCoffee = await bodyOf<IssuerMeResponse>(switchTo(token, coffee))
    const added = await postJson(
      app,
      bindings(),
      '/v1/issuers/cards',
      { ...SECOND_CARD, slug: 'latte' },
      token,
    )
    const coffeeNow = await me(token)
    await switchTo(token, bar)
    const barNow = await me(token)
    expect({
      added: added.status,
      bar: barNow.cards.map((card) => card.slug),
      coffee: coffeeNow.cards.map((card) => card.slug),
      switched: toCoffee.issuer?.handle,
    }).toStrictEqual({ added: 201, bar: ['gig'], coffee: ['stamp', 'latte'], switched: 'wassie-coffee' })
  })

  it('starts a new session on the oldest issuer', async () => {
    await twoIssuers()
    const again = await signIn(app, bindings())
    expect(again.issuer).toMatchObject({ handle: 'wassie-coffee' })
  })

  it('never switches to another account’s issuer', async () => {
    const { coffee } = await twoIssuers()
    const { token: stranger } = await signIn(app, bindings(), other)
    const [foreign, malformed] = await Promise.all([
      switchTo(stranger, coffee),
      postJson(app, bindings(), '/v1/issuers/switch', { id: coffee }, stranger),
    ])
    const strangerMe = await me(stranger)
    expect([foreign.status, malformed.status, strangerMe.issuer]).toStrictEqual([404, 400, null])
  })

  it('caps the issuers one account can create', async () => {
    const { token } = await signIn(app, bindings())
    const statuses: number[] = []
    for (const n of Array.from({ length: 11 }, (_, i) => i)) {
      // oxlint-disable-next-line no-await-in-loop -- each create must see the ones before it
      const res = await postJson(app, bindings(), '/v1/issuers', { ...COFFEE, handle: `shop-${n}` }, token)
      statuses.push(res.status)
    }
    const last = await postJson(app, bindings(), '/v1/issuers', { ...COFFEE, handle: 'shop-extra' }, token)
    expect([
      statuses.filter((status) => status === 201).length,
      last.status,
      await last.json(),
    ]).toStrictEqual([10, 409, { error: 'issuer_limit' }])
  })

  it('lets a connected app be approved for either issuer, and keeps each token to its own', async () => {
    const { bar, coffee, token } = await twoIssuers()
    const ORIGIN = 'https://shop.figma.site'
    const created = await postJson(
      app,
      bindings(),
      '/v1/connected-apps',
      { name: 'Shop app', redirectUris: [`${ORIGIN}/`] },
      token,
    )
    const { app: registered } = await created.json<{ app: { clientId: string } }>()
    const preview = await bodyOf<AuthorizePreviewResponse>(
      getJson(
        app,
        bindings(),
        `/v1/oauth/authorize?${new URLSearchParams({
          client_id: registered.clientId,
          code_challenge_method: 'S256',
          redirect_uri: `${ORIGIN}/`,
          response_type: 'code',
        }).toString()}`,
        token,
      ),
    )
    const verifier = 'v'.repeat(43)
    const tokenFor = async (issuerId: string): Promise<string> => {
      const approved = await bodyOf<{ redirectTo: string }>(
        postJson(
          app,
          bindings(),
          '/v1/oauth/authorize',
          {
            clientId: registered.clientId,
            codeChallenge: await pkceChallenge(verifier),
            codeChallengeMethod: 'S256',
            issuerId,
            redirectUri: `${ORIGIN}/`,
          },
          token,
        ),
      )
      const issued = await bodyOf<TokenResponse>(
        app.request(
          '/v1/oauth/token',
          {
            body: new URLSearchParams({
              client_id: registered.clientId,
              code: new URL(approved.redirectTo).searchParams.get('code') ?? '',
              code_verifier: verifier,
              grant_type: 'authorization_code',
              redirect_uri: `${ORIGIN}/`,
            }).toString(),
            headers: {
              'CF-Connecting-IP': '203.0.113.7',
              'content-type': 'application/x-www-form-urlencoded',
            },
            method: 'POST',
          },
          bindings(),
        ),
      )
      return issued.access_token
    }
    const coffeeToken = await tokenFor(coffee)
    const barToken = await tokenFor(bar)
    const listFor = async (access: string): Promise<string[]> => {
      const listed = await bodyOf<ConnectCardsResponse>(
        app.request('/v1/connect/cards', { headers: { authorization: `Bearer ${access}` } }, bindings()),
      )
      return listed.cards.map((card) => card.slug)
    }
    const barNow = await me(token)
    const barCardId = barNow.cards[0]?.id ?? ''
    const crossRead = await app.request(
      `/v1/connect/cards/${barCardId}`,
      { headers: { authorization: `Bearer ${coffeeToken}` } },
      bindings(),
    )
    expect({
      bar: await listFor(barToken),
      choices: preview.issuers.map((issuer) => issuer.handle),
      coffee: await listFor(coffeeToken),
      crossRead: crossRead.status,
    }).toStrictEqual({
      bar: ['gig'],
      choices: ['wassie-coffee', 'wassie-bar'],
      coffee: ['stamp'],
      crossRead: 404,
    })
  })
})
