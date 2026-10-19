import {
  AuthorizeApprovalBody,
  CardBody,
  ConnectedAppBody,
  normalizeRedirectUri,
  parseScope,
  TokenRequestBody,
} from '@fuda/sdk'
import type {
  AuthorizePreviewResponse,
  ConnectCardResponse,
  ConnectCardsResponse,
  ConnectIssuerResponse,
  ConnectedAppScope,
  ConnectedAppView,
  TokenResponse,
} from '@fuda/sdk'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import * as v from 'valibot'

import {
  appHasOrigin,
  connectedIssuerView,
  deleteApp,
  findApp,
  issuersOwnedBy,
  listApps,
  listGrants,
  mintCode,
  redeemCode,
  registerApp,
  revokeByToken,
  revokeGrant,
} from '../connected-apps/store.ts'
import { cards, issuers } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { insertCard } from '../issuers/create.ts'
import { fieldErrorFor } from '../issuers/field-error.ts'
import { cardView, issuerView, publicUrlFor } from '../issuers/views.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { connectedAppAuth } from '../middleware/connected-app-auth.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'
import { DEFAULT_BUDGET, rateLimit } from '../middleware/rate-limit.ts'

export const connectedAppRoutes = new Hono<AppEnv>()

const noStore = async (c: Context<AppEnv>, next: () => Promise<void>): Promise<void> => {
  c.header('cache-control', 'no-store')
  await next()
}

connectedAppRoutes.use('/connected-apps', noStore)
connectedAppRoutes.use('/connected-apps/*', noStore)
connectedAppRoutes.use('/oauth/*', noStore)

// --- Registration and approvals, from the dashboard -------------------------
// docs/specs/connected-apps.md#registering-an-app

connectedAppRoutes.get('/connected-apps', operatorAuth(), async (c) =>
  jsonResponse(c, { apps: await listApps(c.get('db'), c.get('operator').address) }),
)

connectedAppRoutes.post('/connected-apps', operatorAuth(), async (c) => {
  const parsed = v.safeParse(ConnectedAppBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    const redirectIssue = parsed.issues.some(
      (issue) => issue.path?.some((segment) => segment.key === 'redirectUris') === true,
    )
    return errorResponse(c, redirectIssue ? 'bad_redirect_uri' : 'bad_input', 400)
  }
  const app = await registerApp(c.get('db'), c.get('operator').address, parsed.output, c.get('now')())
  return app === null ? errorResponse(c, 'app_limit', 409) : jsonResponse(c, { app }, 201)
})

connectedAppRoutes.get('/connected-apps/grants', operatorAuth(), async (c) =>
  jsonResponse(c, {
    grants: await listGrants(c.get('db'), c.get('operator').address, c.get('now')(), c.env.API_BASE_URL),
  }),
)

connectedAppRoutes.delete('/connected-apps/grants/:id', operatorAuth(), async (c) =>
  (await revokeGrant(c.get('db'), c.get('operator').address, c.req.param('id'), c.get('now')()))
    ? jsonResponse(c, { revoked: true })
    : errorResponse(c, 'not_found', 404),
)

connectedAppRoutes.delete('/connected-apps/:clientId', operatorAuth(), async (c) =>
  (await deleteApp(c.get('db'), c.get('operator').address, c.req.param('clientId')))
    ? jsonResponse(c, { deleted: true })
    : errorResponse(c, 'not_found', 404),
)

// --- Authorization, from the dashboard's consent page ------------------------
// docs/specs/connected-apps.md#approval

type ApprovalCheck =
  | { ok: true; app: ConnectedAppView; redirectUri: string; scope: ConnectedAppScope[] }
  | { ok: false; error: 'invalid_client' | 'bad_redirect_uri' | 'not_app_owner' | 'invalid_scope' }

// The order matters to the consent page: the first two failures mean the
// redirect URI cannot be trusted, so the page shows them instead of sending
// the browser anywhere.
const checkApproval = async (
  c: Context<AppEnv>,
  p: { clientId: string; redirectUri: string; scope: string },
): Promise<ApprovalCheck> => {
  const app = await findApp(c.get('db'), p.clientId)
  if (app === null) {
    return { error: 'invalid_client', ok: false }
  }
  const redirectUri = normalizeRedirectUri(p.redirectUri)
  if (redirectUri === null || !app.redirectUris.includes(redirectUri)) {
    return { error: 'bad_redirect_uri', ok: false }
  }
  // Only the account that registered the app may approve it.
  if (app.owner !== c.get('operator').address) {
    return { error: 'not_app_owner', ok: false }
  }
  const scope = parseScope(p.scope)
  return scope === null ? { error: 'invalid_scope', ok: false } : { app, ok: true, redirectUri, scope }
}

const approvalStatus = (error: Extract<ApprovalCheck, { ok: false }>['error']): 400 | 403 =>
  error === 'not_app_owner' ? 403 : 400

connectedAppRoutes.get('/oauth/authorize', operatorAuth(), async (c) => {
  const checked = await checkApproval(c, {
    clientId: c.req.query('client_id') ?? '',
    redirectUri: c.req.query('redirect_uri') ?? '',
    scope: c.req.query('scope') ?? '',
  })
  if (!checked.ok) {
    return errorResponse(c, checked.error, approvalStatus(checked.error))
  }
  if (c.req.query('response_type') !== 'code' || c.req.query('code_challenge_method') !== 'S256') {
    return errorResponse(c, 'invalid_request', 400)
  }
  const owned = await issuersOwnedBy(c.get('db'), c.get('operator').address)
  const body: AuthorizePreviewResponse = {
    app: { clientId: checked.app.clientId, name: checked.app.name },
    issuers: owned.map((row) => connectedIssuerView(row, c.env.API_BASE_URL)),
    redirectUri: checked.redirectUri,
    scope: checked.scope,
  }
  return jsonResponse(c, body)
})

connectedAppRoutes.post('/oauth/authorize', operatorAuth(), async (c) => {
  const parsed = v.safeParse(AuthorizeApprovalBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse(c, 'invalid_request', 400)
  }
  const checked = await checkApproval(c, parsed.output)
  if (!checked.ok) {
    return errorResponse(c, checked.error, approvalStatus(checked.error))
  }
  const { address } = c.get('operator')
  // The issuer must be the signed-in account's own, read from the issuers
  // table rather than the session, so a token never reaches past it.
  const owned = await issuersOwnedBy(c.get('db'), address)
  if (!owned.some((row) => row.id === parsed.output.issuerId)) {
    return errorResponse(c, 'not_found', 404)
  }
  const code = await mintCode(c.get('db'), {
    address,
    clientId: checked.app.clientId,
    codeChallenge: parsed.output.codeChallenge,
    issuerId: parsed.output.issuerId,
    now: c.get('now')(),
    redirectUri: checked.redirectUri,
    scope: checked.scope,
  })
  const target = new URL(checked.redirectUri)
  target.searchParams.set('code', code)
  if (parsed.output.state !== '') {
    target.searchParams.set('state', parsed.output.state)
  }
  return jsonResponse(c, { redirectTo: target.href })
})

// --- Token and revocation, called by the app itself --------------------------
// docs/specs/connected-apps.md#token-exchange

// RFC 6749 sends these as a form; JSON is accepted too because it is what a
// fetch() written by hand usually sends.
// oxlint-disable-next-line anti-slop/no-unknown-returns -- request bodies are untyped until a schema parses them
const readParams = async (c: Context<AppEnv>): Promise<unknown> => {
  const type = c.req.header('content-type') ?? ''
  if (type.startsWith('application/x-www-form-urlencoded')) {
    // Decoded by hand: workerd warns when .text() reads a form body.
    return Object.fromEntries(new URLSearchParams(new TextDecoder().decode(await c.req.arrayBuffer())))
  }
  return await c.req.json().catch(() => null)
}

connectedAppRoutes.post('/oauth/token', rateLimit({ budget: DEFAULT_BUDGET }), async (c) => {
  c.header('pragma', 'no-cache')
  const parsed = v.safeParse(TokenRequestBody, await readParams(c))
  if (!parsed.success) {
    return errorResponse(c, 'invalid_request', 400)
  }
  const params = parsed.output
  if (params.grant_type !== 'authorization_code') {
    return errorResponse(c, 'unsupported_grant_type', 400)
  }
  const db = c.get('db')
  const app = await findApp(db, params.client_id)
  const origin = c.req.header('Origin')
  if (app === null || (origin !== undefined && !(await appHasOrigin(db, app.clientId, origin)))) {
    return errorResponse(c, 'invalid_client', 401)
  }
  const issued = await redeemCode(db, {
    clientId: app.clientId,
    code: params.code,
    codeVerifier: params.code_verifier,
    now: c.get('now')(),
    redirectUri: normalizeRedirectUri(params.redirect_uri) ?? '',
  })
  if (issued === null) {
    return errorResponse(c, 'invalid_grant', 400)
  }
  const body: TokenResponse = {
    access_token: issued.accessToken,
    expires_in: issued.expiresIn,
    issuer: connectedIssuerView(issued.issuer, c.env.API_BASE_URL),
    scope: issued.scope.join(' '),
    token_type: 'Bearer',
  }
  return jsonResponse(c, body)
})

const RevokeParams = v.object({
  client_id: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  token: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
})

// RFC 7009 §2.2: the answer is 200 whether or not the token was live, so the
// endpoint says nothing about which tokens exist.
connectedAppRoutes.post('/oauth/revoke', rateLimit({ budget: DEFAULT_BUDGET }), async (c) => {
  const parsed = v.safeParse(RevokeParams, await readParams(c))
  if (!parsed.success) {
    return errorResponse(c, 'invalid_request', 400)
  }
  await revokeByToken(c.get('db'), parsed.output.token, parsed.output.client_id, c.get('now')())
  return jsonResponse(c, {})
})

// --- Resource routes, with the app's access token -----------------------------
// docs/specs/connected-apps.md#resource-routes

const connectedIssuer = async (c: Context<AppEnv>): Promise<typeof issuers.$inferSelect | undefined> =>
  await c
    .get('db')
    .select()
    .from(issuers)
    .where(eq(issuers.id, c.get('connected').issuerId))
    .get()

connectedAppRoutes.get('/connect/issuer', connectedAppAuth(null), async (c) => {
  const issuer = await connectedIssuer(c)
  if (issuer === undefined) {
    return errorResponse(c, 'not_found', 404)
  }
  const body: ConnectIssuerResponse = {
    issuer: issuerView(issuer, c.env.API_BASE_URL),
    publicUrl: publicUrlFor(c.env.PUBLIC_BASE_URL, issuer.handle),
    scope: c.get('connected').scope,
  }
  return jsonResponse(c, body)
})

connectedAppRoutes.get('/connect/cards', connectedAppAuth('cards:read'), async (c) => {
  const issuer = await connectedIssuer(c)
  if (issuer === undefined) {
    return errorResponse(c, 'not_found', 404)
  }
  const owned = await c
    .get('db')
    .select()
    .from(cards)
    .where(eq(cards.issuerId, issuer.id))
    .orderBy(cards.createdAt)
  const now = c.get('now')()
  const body: ConnectCardsResponse = {
    cards: owned.map((card) => cardView(card, now)),
    publicUrl: publicUrlFor(c.env.PUBLIC_BASE_URL, issuer.handle),
  }
  return jsonResponse(c, body)
})

// The same card rules as the dashboard's POST /issuers/cards, and the same
// answer. Synchronous: the card is published when this returns, and no ENS
// claim is needed for it.
connectedAppRoutes.post('/connect/cards', connectedAppAuth('cards:write'), async (c) => {
  const parsed = v.safeParse(CardBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse(c, fieldErrorFor(parsed.issues, 'slug', 'bad_slug'), 400)
  }
  const issuer = await connectedIssuer(c)
  if (issuer === undefined) {
    return errorResponse(c, 'not_found', 404)
  }
  const card = await insertCard(c.get('db'), issuer.id, parsed.output, c.get('now')())
  if (card === null) {
    return errorResponse(c, 'slug_taken', 409)
  }
  return jsonResponse(
    c,
    {
      card: cardView(card, c.get('now')()),
      issuer: issuerView(issuer, c.env.API_BASE_URL),
      publicUrl: publicUrlFor(c.env.PUBLIC_BASE_URL, issuer.handle),
    },
    201,
  )
})

// Another issuer's card is "not found", never "forbidden": the token cannot
// learn that a card id exists outside its issuer.
connectedAppRoutes.get('/connect/cards/:cardId', connectedAppAuth('cards:read'), async (c) => {
  const db = c.get('db')
  const { issuerId } = c.get('connected')
  const [card, issuer] = await Promise.all([
    db
      .select()
      .from(cards)
      .where(and(eq(cards.id, c.req.param('cardId')), eq(cards.issuerId, issuerId)))
      .get(),
    connectedIssuer(c),
  ])
  if (card === undefined || issuer === undefined) {
    return errorResponse(c, 'not_found', 404)
  }
  const body: ConnectCardResponse = {
    card: cardView(card, c.get('now')()),
    url: `${publicUrlFor(c.env.PUBLIC_BASE_URL, issuer.handle)}/${card.slug}`,
  }
  return jsonResponse(c, body)
})
