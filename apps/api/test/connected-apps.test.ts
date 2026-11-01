import type {
  AuthorizePreviewResponse,
  CardCreateResponse,
  ConnectCardResponse,
  ConnectCardsResponse,
  ConnectIssuerResponse,
  ConnectedAppGrantsResponse,
  ConnectedAppResponse,
  PublicVenue,
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
import { CARD_INPUT, getJson, postJson, registerVenueWithCard, SECOND_CARD, signIn } from './operator.ts'

const ORIGIN = 'https://shop.figma.site'
const REDIRECT_URI = `${ORIGIN}/callback`
const VERIFIER = 'v'.repeat(43)
const STATE = 'opaque-state-123'

const bindings = () => testEnv()
const db = () => getDb({ DB: env.DB })

let clock = 1000
const app = appWith({ chain: fakeChain(), now: () => clock })

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

const bodyOf = async <T>(pending: Promise<Response>): Promise<T> => {
  const res = await pending
  return await res.json<T>()
}

describe('connected apps', () => {
  beforeEach(async () => {
    clock = 1000
    await clearTables()
  })
  afterEach(clearTables)

  const send = async (
    path: string,
    init: { body?: string; headers?: HeadersInit; method?: string },
  ): Promise<Response> => await app.request(path, init, bindings())

  const deleteWith = async (path: string, token: string): Promise<Response> =>
    await send(path, { headers: { authorization: `Bearer ${token}` }, method: 'DELETE' })

  // The token request exactly as a browser app sends it: a form body, its own
  // Origin, and the client IP Cloudflare adds.
  const exchange = async (
    params: Record<string, string>,
    origin: string | null = ORIGIN,
  ): Promise<Response> => {
    const headers = new Headers({
      'CF-Connecting-IP': '203.0.113.7',
      'content-type': 'application/x-www-form-urlencoded',
    })
    if (origin !== null) {
      headers.set('Origin', origin)
    }
    return await send('/v1/oauth/token', {
      body: new URLSearchParams(params).toString(),
      headers,
      method: 'POST',
    })
  }

  const withToken = async (
    path: string,
    token: string,
    init: { body?: unknown; method?: string; origin?: string } = {},
  ): Promise<Response> => {
    const headers = new Headers({ Origin: init.origin ?? ORIGIN, authorization: `Bearer ${token}` })
    if (init.body !== undefined) {
      headers.set('content-type', 'application/json')
    }
    return await send(path, {
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers,
      method: init.method ?? 'GET',
    })
  }

  interface Owner {
    clientId: string
    issuerId: string
    session: string
  }

  // An operator with a venue (no ENS claim) and one registered app.
  const ownerWithApp = async (): Promise<Owner> => {
    const { token: session } = await signIn(app, bindings())
    await registerVenueWithCard(app, bindings(), CARD_INPUT, session)
    const created = await postJson(
      app,
      bindings(),
      '/v1/connected-apps',
      { name: 'Shop app', redirectUris: [REDIRECT_URI, 'http://localhost:5173/'] },
      session,
    )
    expect(created.status).toBe(201)
    const { app: registered } = await created.json<ConnectedAppResponse>()
    const me = await getJson(app, bindings(), '/v1/issuers/me', session)
    const { issuer } = await me.json<{ issuer: { id: string } }>()
    return { clientId: registered.clientId, issuerId: issuer.id, session }
  }

  const approve = async (
    owner: Owner,
    overrides: Record<string, string> = {},
    session = owner.session,
  ): Promise<Response> =>
    await postJson(
      app,
      bindings(),
      '/v1/oauth/authorize',
      {
        clientId: owner.clientId,
        codeChallenge: await pkceChallenge(VERIFIER),
        codeChallengeMethod: 'S256',
        issuerId: owner.issuerId,
        redirectUri: REDIRECT_URI,
        state: STATE,
        ...overrides,
      },
      session,
    )

  const codeFor = async (owner: Owner, overrides: Record<string, string> = {}): Promise<string> => {
    const res = await approve(owner, overrides)
    expect(res.status).toBe(200)
    const { redirectTo } = await res.json<{ redirectTo: string }>()
    return new URL(redirectTo).searchParams.get('code') ?? ''
  }

  const tokenRequest = (owner: Owner, code: string) => ({
    client_id: owner.clientId,
    code,
    code_verifier: VERIFIER,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
  })

  const accessTokenFor = async (owner: Owner, overrides: Record<string, string> = {}): Promise<string> => {
    const res = await exchange(tokenRequest(owner, await codeFor(owner, overrides)))
    expect(res.status).toBe(200)
    const issued = await res.json<TokenResponse>()
    return issued.access_token
  }

  describe('connected app flow', () => {
    it('approves, exchanges a code and creates a card the venue page then shows, without an ENS claim', async () => {
      const owner = await ownerWithApp()
      const preview = await getJson(
        app,
        bindings(),
        `/v1/oauth/authorize?${new URLSearchParams({
          client_id: owner.clientId,
          code_challenge_method: 'S256',
          redirect_uri: REDIRECT_URI,
          response_type: 'code',
        }).toString()}`,
        owner.session,
      )
      const shown = await preview.json<AuthorizePreviewResponse>()
      expect(shown).toMatchObject({
        app: { clientId: owner.clientId, name: 'Shop app' },
        issuers: [{ handle: 'wassie-coffee', id: owner.issuerId }],
        scope: ['cards:read', 'cards:write'],
      })

      const approved = await approve(owner)
      const { redirectTo } = await approved.json<{ redirectTo: string }>()
      const redirect = new URL(redirectTo)
      expect([`${redirect.origin}${redirect.pathname}`, redirect.searchParams.get('state')]).toStrictEqual([
        REDIRECT_URI,
        STATE,
      ])

      const tokenRes = await exchange(tokenRequest(owner, redirect.searchParams.get('code') ?? ''))
      expect(tokenRes.headers.get('access-control-allow-origin')).toBe(ORIGIN)
      const issued = await tokenRes.json<TokenResponse>()
      expect(issued).toMatchObject({
        issuer: { handle: 'wassie-coffee', id: owner.issuerId },
        scope: 'cards:read cards:write',
        token_type: 'Bearer',
      })

      const created = await withToken('/v1/connect/cards', issued.access_token, {
        body: SECOND_CARD,
        method: 'POST',
      })
      const { card } = await created.json<CardCreateResponse>()
      const readBody = await bodyOf<ConnectCardResponse>(
        withToken(`/v1/connect/cards/${card.id}`, issued.access_token),
      )
      const published = await bodyOf<PublicVenue>(getJson(app, bindings(), '/v1/issuers/wassie-coffee'))
      expect({
        created: created.status,
        publicSlugs: published.cards.map((c) => c.slug),
        read: { id: readBody.card.id, title: readBody.card.title, url: new URL(readBody.url).pathname },
      }).toStrictEqual({
        created: 201,
        publicSlugs: ['stamp', 'gig'],
        read: { id: card.id, title: 'Gig Ticket', url: '/@wassie-coffee/gig' },
      })
    })

    it('reads the approved issuer and its cards', async () => {
      const owner = await ownerWithApp()
      const token = await accessTokenFor(owner)
      const issuer = await bodyOf<ConnectIssuerResponse>(withToken('/v1/connect/issuer', token))
      expect(issuer.issuer.handle).toBe('wassie-coffee')
      const listed = await bodyOf<ConnectCardsResponse>(withToken('/v1/connect/cards', token))
      expect(listed.cards.map((c) => c.slug)).toStrictEqual(['stamp'])
    })

    it('reports a taken slug and a bad card body as the dashboard does', async () => {
      const owner = await ownerWithApp()
      const token = await accessTokenFor(owner)
      const taken = await withToken('/v1/connect/cards', token, { body: CARD_INPUT.card, method: 'POST' })
      const bad = await withToken('/v1/connect/cards', token, {
        body: { ...SECOND_CARD, slug: 'Not A Slug' },
        method: 'POST',
      })
      expect([taken.status, await taken.json(), bad.status, await bad.json()]).toStrictEqual([
        409,
        { error: 'slug_taken' },
        400,
        { error: 'bad_slug' },
      ])
    })
  })

  describe('approval', () => {
    it('lets only the account that registered the app approve it', async () => {
      const owner = await ownerWithApp()
      const { token: stranger } = await signIn(app, bindings(), other)
      const res = await approve(owner, {}, stranger)
      expect([res.status, await res.json()]).toStrictEqual([403, { error: 'not_app_owner' }])
    })

    it('refuses an unknown app, an unregistered redirect URI and a bad scope', async () => {
      const owner = await ownerWithApp()
      const responses = await Promise.all([
        approve(owner, { clientId: 'app_nope' }),
        approve(owner, { redirectUri: `${ORIGIN}/elsewhere` }),
        approve(owner, { redirectUri: 'https://evil.example/callback' }),
        approve(owner, { scope: 'passes:write' }),
      ])
      await expect(Promise.all(responses.map(async (res) => await res.json()))).resolves.toStrictEqual([
        { error: 'invalid_client' },
        { error: 'bad_redirect_uri' },
        { error: 'bad_redirect_uri' },
        { error: 'invalid_scope' },
      ])
    })

    it('never binds a code to an issuer the account does not own', async () => {
      const owner = await ownerWithApp()
      const { token: strangerSession } = await signIn(app, bindings(), other)
      await registerVenueWithCard(app, bindings(), { ...CARD_INPUT, handle: 'other-cafe' }, strangerSession)
      const theirs = await getJson(app, bindings(), '/v1/issuers/me', strangerSession)
      const { issuer } = await theirs.json<{ issuer: { id: string } }>()
      const res = await approve(owner, { issuerId: issuer.id })
      expect([res.status, await res.json()]).toStrictEqual([404, { error: 'not_found' }])
    })

    it('needs an operator session: an access token cannot approve or create a venue', async () => {
      const owner = await ownerWithApp()
      const token = await accessTokenFor(owner)
      const [approval, venue] = await Promise.all([
        approve(owner, {}, token),
        postJson(app, bindings(), '/v1/issuers', { ...CARD_INPUT, handle: 'new-shop' }, token),
      ])
      expect([approval.status, venue.status]).toStrictEqual([401, 401])
    })
  })

  describe('token exchange', () => {
    it('spends a code once, even when the first try had the wrong verifier', async () => {
      const owner = await ownerWithApp()
      const code = await codeFor(owner)
      const wrong = await exchange({ ...tokenRequest(owner, code), code_verifier: 'w'.repeat(43) })
      const retry = await exchange(tokenRequest(owner, code))
      expect([await wrong.json(), await retry.json()]).toStrictEqual([
        { error: 'invalid_grant' },
        { error: 'invalid_grant' },
      ])
    })

    it('refuses a replayed code', async () => {
      const owner = await ownerWithApp()
      const code = await codeFor(owner)
      const first = await exchange(tokenRequest(owner, code))
      const second = await exchange(tokenRequest(owner, code))
      expect([first.status, second.status, await second.json()]).toStrictEqual([
        200,
        400,
        { error: 'invalid_grant' },
      ])
    })

    it('refuses a code sent with another redirect URI, after its lifetime, or from another origin', async () => {
      const owner = await ownerWithApp()
      const mismatched = await exchange({
        ...tokenRequest(owner, await codeFor(owner)),
        redirect_uri: 'http://localhost:5173/',
      })
      const foreign = await exchange(tokenRequest(owner, await codeFor(owner)), 'https://other.figma.site')
      const late = await codeFor(owner)
      clock += 601
      const expired = await exchange(tokenRequest(owner, late))
      expect([await mismatched.json(), await foreign.json(), await expired.json()]).toStrictEqual([
        { error: 'invalid_grant' },
        { error: 'invalid_client' },
        { error: 'invalid_grant' },
      ])
    })

    it('accepts JSON as well as a form, and answers unsupported grants in RFC terms', async () => {
      const owner = await ownerWithApp()
      const json = await send('/v1/oauth/token', {
        body: JSON.stringify(tokenRequest(owner, await codeFor(owner))),
        headers: { 'CF-Connecting-IP': '203.0.113.8', 'content-type': 'application/json' },
        method: 'POST',
      })
      const refresh = await exchange({ ...tokenRequest(owner, 'x'), grant_type: 'refresh_token' })
      expect([json.status, await refresh.json()]).toStrictEqual([200, { error: 'unsupported_grant_type' }])
    })
  })

  describe('issuer scope of an access token', () => {
    it('cannot read another issuer’s card, and lists only its own', async () => {
      const owner = await ownerWithApp()
      const token = await accessTokenFor(owner)
      const { token: strangerSession } = await signIn(app, bindings(), other)
      await registerVenueWithCard(
        app,
        bindings(),
        { ...CARD_INPUT, card: SECOND_CARD, handle: 'other-cafe' },
        strangerSession,
      )
      const theirs = await bodyOf<{ cards: { id: string }[] }>(
        getJson(app, bindings(), '/v1/issuers/me', strangerSession),
      )
      const foreignCard = theirs.cards[0]?.id ?? ''
      const read = await withToken(`/v1/connect/cards/${foreignCard}`, token)
      const listed = await bodyOf<ConnectCardsResponse>(withToken('/v1/connect/cards', token))
      expect([read.status, listed.cards.map((c) => c.slug)]).toStrictEqual([404, ['stamp']])
    })

    it('is refused by the dashboard routes, and a session is refused by the app routes', async () => {
      const owner = await ownerWithApp()
      const token = await accessTokenFor(owner)
      const [dashboard, connect] = await Promise.all([
        getJson(app, bindings(), '/v1/issuers/me', token),
        withToken('/v1/connect/cards', owner.session),
      ])
      expect([dashboard.status, connect.status]).toStrictEqual([401, 401])
      expect(connect.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"')
    })

    it('creates nothing with a read-only token', async () => {
      const owner = await ownerWithApp()
      const token = await accessTokenFor(owner, { scope: 'cards:read' })
      const res = await withToken('/v1/connect/cards', token, { body: SECOND_CARD, method: 'POST' })
      expect([res.status, await res.json()]).toStrictEqual([403, { error: 'insufficient_scope' }])
    })

    it('is refused from a page that is not one of its app’s origins', async () => {
      const owner = await ownerWithApp()
      const token = await accessTokenFor(owner)
      const [own, local, elsewhere] = await Promise.all([
        withToken('/v1/connect/issuer', token),
        withToken('/v1/connect/issuer', token, { origin: 'http://localhost:5173' }),
        withToken('/v1/connect/issuer', token, { origin: 'https://other.figma.site' }),
      ])
      expect([own.status, local.status, elsewhere.status]).toStrictEqual([200, 200, 401])
    })
  })

  describe('ending an approval', () => {
    it('stops a token revoked from the dashboard', async () => {
      const owner = await ownerWithApp()
      const token = await accessTokenFor(owner)
      const listed = await getJson(app, bindings(), '/v1/connected-apps/grants', owner.session)
      const { grants } = await listed.json<ConnectedAppGrantsResponse>()
      expect(grants).toMatchObject([{ appName: 'Shop app', issuer: { handle: 'wassie-coffee' } }])
      const revoked = await deleteWith(`/v1/connected-apps/grants/${grants[0]?.id ?? ''}`, owner.session)
      const after = await withToken('/v1/connect/issuer', token)
      expect([revoked.status, after.status]).toStrictEqual([200, 401])
    })

    it('stops a token the app revoked itself', async () => {
      const owner = await ownerWithApp()
      const token = await accessTokenFor(owner)
      const revoked = await send('/v1/oauth/revoke', {
        body: new URLSearchParams({ client_id: owner.clientId, token }).toString(),
        headers: { 'CF-Connecting-IP': '203.0.113.9', 'content-type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      })
      const after = await withToken('/v1/connect/issuer', token)
      expect([revoked.status, after.status]).toStrictEqual([200, 401])
    })

    it('stops every token of a deleted app, and a token past its lifetime', async () => {
      const owner = await ownerWithApp()
      const kept = await accessTokenFor(owner)
      clock += 30 * 24 * 60 * 60
      const expired = await withToken('/v1/connect/issuer', kept)
      // The dashboard session ran out with the token; sign in again.
      const { token: session } = await signIn(app, bindings())
      const fresh = await accessTokenFor({ ...owner, session })
      const deleted = await deleteWith(`/v1/connected-apps/${owner.clientId}`, session)
      const after = await withToken('/v1/connect/issuer', fresh)
      expect([expired.status, deleted.status, after.status]).toStrictEqual([401, 200, 401])
    })

    it('does not let another account revoke or delete', async () => {
      const owner = await ownerWithApp()
      await accessTokenFor(owner)
      const { grants } = await bodyOf<ConnectedAppGrantsResponse>(
        getJson(app, bindings(), '/v1/connected-apps/grants', owner.session),
      )
      const { token: stranger } = await signIn(app, bindings(), other)
      const [grant, appDelete] = await Promise.all([
        deleteWith(`/v1/connected-apps/grants/${grants[0]?.id ?? ''}`, stranger),
        deleteWith(`/v1/connected-apps/${owner.clientId}`, stranger),
      ])
      expect([grant.status, appDelete.status]).toStrictEqual([404, 404])
    })
  })

  describe('app registration', () => {
    it('lists an account’s own apps only and refuses an unsafe redirect URI', async () => {
      const owner = await ownerWithApp()
      const { token: stranger } = await signIn(app, bindings(), other)
      const [mine, theirs, unsafe] = await Promise.all([
        getJson(app, bindings(), '/v1/connected-apps', owner.session),
        getJson(app, bindings(), '/v1/connected-apps', stranger),
        postJson(
          app,
          bindings(),
          '/v1/connected-apps',
          { name: 'Bad', redirectUris: ['http://shop.example/'] },
          owner.session,
        ),
      ])
      const { apps } = await mine.json<{ apps: unknown[] }>()
      expect(apps).toHaveLength(1)
      expect([await theirs.json(), unsafe.status, await unsafe.json()]).toStrictEqual([
        { apps: [] },
        400,
        { error: 'bad_redirect_uri' },
      ])
    })
  })

  describe('cors for connected apps', () => {
    const preflight = async (path: string, origin: string): Promise<string | null> => {
      const res = await send(path, {
        headers: { 'Access-Control-Request-Method': 'POST', Origin: origin },
        method: 'OPTIONS',
      })
      return res.headers.get('access-control-allow-origin')
    }

    it('allows Figma Make sites and registered origins on the app routes only', async () => {
      await ownerWithApp()
      const allowed = await Promise.all([
        preflight('/v1/connect/cards', 'https://another.figma.site'),
        preflight('/v1/oauth/token', 'http://localhost:5173'),
        preflight('/v1/connect/cards', ORIGIN),
      ])
      expect(allowed).toStrictEqual(['https://another.figma.site', 'http://localhost:5173', ORIGIN])
      const refused = await Promise.all([
        preflight('/v1/connect/cards', 'https://evil.example'),
        preflight('/v1/oauth/token', 'https://figma.site.evil.example'),
        preflight('/v1/issuers/me', ORIGIN),
        preflight('/v1/oauth/authorize', ORIGIN),
      ])
      expect(refused).toStrictEqual([null, null, null, null])
    })

    it('allows an origin once an app registers it', async () => {
      const before = await preflight('/v1/connect/cards', 'https://shop.example')
      const owner = await ownerWithApp()
      await postJson(
        app,
        bindings(),
        '/v1/connected-apps',
        { name: 'Own site', redirectUris: ['https://shop.example/'] },
        owner.session,
      )
      const after = await preflight('/v1/connect/cards', 'https://shop.example')
      expect([before, after]).toStrictEqual([null, 'https://shop.example'])
    })
  })
})
