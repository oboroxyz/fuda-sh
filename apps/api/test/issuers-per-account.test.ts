import type {
  AuthorizePreviewResponse,
  ConnectCardsResponse,
  IssuerCreateResponse,
  IssuerMeResponse,
  IssuerSwitchResponse,
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
  await postJson(app, bindings(), '/v1/auth/switch', { issuerId }, token)

const owned = async (token: string): Promise<OwnedIssuersResponse> =>
  await bodyOf<OwnedIssuersResponse>(getJson(app, bindings(), '/v1/auth/issuers', token))

const putJson = async (path: string, body: unknown, token: string): Promise<Response> =>
  await app.request(
    path,
    {
      body: JSON.stringify(body),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      method: 'PUT',
    },
    bindings(),
  )

interface TwoIssuers {
  bar: string
  barToken: string
  coffee: string
  coffeeToken: string
}

// An account with two issuers: Coffee (with its stamp card) on the session
// that created it, then Bar (with a ticket) on the session its create answered.
const twoIssuers = async (): Promise<TwoIssuers> => {
  const { token: coffeeToken } = await signIn(app, bindings())
  await postJson(app, bindings(), '/v1/issuers', COFFEE, coffeeToken)
  await postJson(app, bindings(), '/v1/issuers/cards', COFFEE_CARD, coffeeToken)
  clock += 1
  const created = await bodyOf<IssuerCreateResponse>(
    postJson(app, bindings(), '/v1/issuers', BAR, coffeeToken),
  )
  const barToken = created.token ?? ''
  await postJson(app, bindings(), '/v1/issuers/cards', SECOND_CARD, barToken)
  const list = await owned(coffeeToken)
  const [coffee, bar] = list.issuers.map((issuer) => issuer.id)
  return { bar: bar ?? '', barToken, coffee: coffee ?? '', coffeeToken }
}

describe('several issuers per account', () => {
  beforeEach(async () => {
    clock = 1000
    await clearTables()
  })
  afterEach(clearTables)

  it('gives a second issuer its own session and leaves the creating session on the first', async () => {
    const { bar, barToken, coffee, coffeeToken } = await twoIssuers()
    const [fromCoffee, fromBar, coffeeMe, barMe] = await Promise.all([
      owned(coffeeToken),
      owned(barToken),
      me(coffeeToken),
      me(barToken),
    ])
    expect({
      active: [fromCoffee.activeIssuerId, fromBar.activeIssuerId],
      cards: [coffeeMe.cards.map((card) => card.slug), barMe.cards.map((card) => card.slug)],
      handles: fromBar.issuers.map((issuer) => issuer.handle),
    }).toStrictEqual({
      active: [coffee, bar],
      cards: [['stamp'], ['gig']],
      handles: ['wassie-coffee', 'wassie-bar'],
    })
  })

  it('switches by a new session, so another tab on the old one still writes to its own issuer', async () => {
    const { bar, coffeeToken } = await twoIssuers()
    // Two tabs share coffeeToken. Tab B switches to Bar; tab A still shows
    // Coffee and saves its profile and a card with the token it holds.
    const switched = await bodyOf<IssuerSwitchResponse>(switchTo(coffeeToken, bar))
    const saved = await putJson(
      '/v1/issuers/me',
      { brandColor: '#112233', name: 'Coffee edited', tagline: 'Only Coffee' },
      coffeeToken,
    )
    const added = await postJson(
      app,
      bindings(),
      '/v1/issuers/cards',
      { ...SECOND_CARD, slug: 'latte' },
      coffeeToken,
    )
    const [coffeeNow, barNow] = await Promise.all([me(coffeeToken), me(switched.token)])
    expect({
      added: added.status,
      bar: [barNow.issuer?.name, barNow.issuer?.tagline, barNow.cards.map((card) => card.slug)],
      coffee: [coffeeNow.issuer?.name, coffeeNow.cards.map((card) => card.slug)],
      saved: saved.status,
      switched: [switched.operator.issuer?.handle, switched.token === coffeeToken],
    }).toStrictEqual({
      added: 201,
      bar: ['Wassie Bar', COFFEE.tagline, ['gig']],
      coffee: ['Coffee edited', ['stamp', 'latte']],
      saved: 200,
      switched: ['wassie-bar', false],
    })
  })

  it('starts a new sign-in on the oldest issuer', async () => {
    await twoIssuers()
    const again = await signIn(app, bindings())
    expect(again.issuer).toMatchObject({ handle: 'wassie-coffee' })
  })

  it('never switches to another account’s issuer', async () => {
    const { coffee } = await twoIssuers()
    const { token: stranger } = await signIn(app, bindings(), other)
    const [foreign, malformed] = await Promise.all([
      switchTo(stranger, coffee),
      postJson(app, bindings(), '/v1/auth/switch', { id: coffee }, stranger),
    ])
    const strangerMe = await me(stranger)
    expect([foreign.status, malformed.status, strangerMe.issuer]).toStrictEqual([404, 400, null])
  })

  it('leaves every handle to the public venue route, including the words the account routes use', async () => {
    const { token } = await signIn(app, bindings())
    await postJson(app, bindings(), '/v1/issuers', { ...COFFEE, handle: 'owned' }, token)
    const [venue, anonymousList] = await Promise.all([
      getJson(app, bindings(), '/v1/issuers/owned'),
      getJson(app, bindings(), '/v1/auth/issuers'),
    ])
    const body = await venue.json<{ handle: string }>()
    expect([venue.status, body.handle, anonymousList.status]).toStrictEqual([200, 'owned', 401])
  })

  it('answers every concurrent first create with a session bound to its own issuer', async () => {
    const { token } = await signIn(app, bindings())
    const creates = await Promise.all(
      ['first-shop', 'second-shop'].map(
        async (handle) =>
          await bodyOf<IssuerCreateResponse>(
            postJson(app, bindings(), '/v1/issuers', { ...COFFEE, handle }, token),
          ),
      ),
    )
    // Whichever create bound the shared session, the other was answered a
    // token of its own; each token reads exactly the issuer it was created for.
    const tokens = creates.map((created) => created.token ?? token)
    const shown = await Promise.all(tokens.map(async (session) => await me(session)))
    expect([
      new Set(tokens).size,
      shown.map((view) => view.issuer?.handle),
      creates.filter((created) => created.token === undefined).length,
    ]).toStrictEqual([2, ['first-shop', 'second-shop'], 1])
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
    const { bar, barToken: barSession, coffee, coffeeToken: token } = await twoIssuers()
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
    const barNow = await me(barSession)
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
