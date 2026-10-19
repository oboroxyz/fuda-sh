import {
  asHex,
  CardBody,
  DefaultCardBody,
  isCardSlug,
  isIssuerHandle,
  IssuerCreateBody,
  IssuerSwitchBody,
  IssuerUpdateBody,
} from '@fuda/sdk'
import type {
  EnsClaimView,
  IssuerCreateResponse,
  IssuerMeResponse,
  IssuerSwitchResponse,
  OwnedIssuersResponse,
} from '@fuda/sdk'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import * as v from 'valibot'

import { createSession, sessionIssuerId } from '../auth/session.ts'
import { configuredBadgeKinds } from '../badges/verifier.ts'
import { cards, issuers } from '../db/schema.ts'
import { issuerEnsName } from '../ens/names.ts'
import { ensNames } from '../ens/schema.ts'
import type { AppEnv } from '../env.ts'
import { badgeKindsByCard } from '../integrations/store.ts'
import { insertCard, insertIssuer } from '../issuers/create.ts'
import { fieldErrorFor } from '../issuers/field-error.ts'
import { issuersOwnedBy, ownedVenue, venueOf } from '../issuers/queries.ts'
import { cardView, issuerSummary, issuerView, publicUrlFor, publicVenue } from '../issuers/views.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'
import { selfServeIssueRoutes } from './self-serve-issue.ts'

export const issuersRoutes = new Hono<AppEnv>()

// The venue's ENS name as the dashboard needs it: what it is called, and whether
// the chain has confirmed the claim. A signed-but-unused voucher reads as
// unclaimed, because the operator's next step is the same either way.
const ensView = async (c: Context<AppEnv>, handle: string): Promise<EnsClaimView | null> => {
  const parentName = c.env.ENS_PARENT_NAME
  if (parentName === undefined) {
    return null
  }
  let name: string
  try {
    name = issuerEnsName(handle, parentName)
  } catch {
    return null
  }
  const row = await c.get('db').select().from(ensNames).where(eq(ensNames.name, name)).get()
  const storedHash = row?.claimTxHash ?? null
  const claimTxHash = storedHash === null ? null : asHex(storedHash, 32)
  return {
    claimTxHash: row?.status === 'claimed' ? claimTxHash : null,
    expiry: row?.status === 'claimed' ? (row.expiry ?? null) : null,
    name,
    status: row?.status === 'claimed' ? 'claimed' : 'unclaimed',
  }
}

// The venue a session is acting for, with its cards and ENS state.
const meResponse = async (c: Context<AppEnv>, issuerId: string | null): Promise<IssuerMeResponse> => {
  const found = await ownedVenue(c.get('db'), issuerId)
  if (found === null) {
    return { cards: [], ens: null, issuer: null, publicUrl: null }
  }
  return {
    cards: found.cards.map((card) => cardView(card, c.get('now')())),
    ens: await ensView(c, found.issuer.handle),
    issuer: issuerView(found.issuer, c.env.API_BASE_URL),
    publicUrl: publicUrlFor(c.env.PUBLIC_BASE_URL, found.issuer.handle),
  }
}

issuersRoutes.get('/issuers/me', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  return jsonResponse(c, await meResponse(c, c.get('operator').issuerId))
})

// docs/adr/0009-several-issuers-per-account.md — every issuer this account
// owns, and the one this session's token is bound to. Under /auth rather than
// /issuers, where a static segment would shadow the public /issuers/:handle of
// a venue whose handle happened to match it.
issuersRoutes.get('/auth/issuers', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const { address, issuerId } = c.get('operator')
  const owned = await issuersOwnedBy(c.get('db'), address)
  const body: OwnedIssuersResponse = {
    activeIssuerId: issuerId,
    issuers: owned.map((row) => issuerSummary(row, c.env.API_BASE_URL)),
  }
  return jsonResponse(c, body)
})

// Acting for another issuer of the same account takes a new session bound to
// it. The session that asked is left exactly as it was: a token is bound to
// one issuer for its whole life, so a second tab still holding it keeps
// writing to the issuer it shows. An id the account does not own is "not
// found", as everywhere else.
issuersRoutes.post('/auth/switch', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const parsed = v.safeParse(IssuerSwitchBody, await c.req.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  const db = c.get('db')
  const { address } = c.get('operator')
  const owned = await issuersOwnedBy(db, address)
  if (!owned.some((row) => row.id === parsed.output.issuerId)) {
    return errorResponse(c, 'not_found', 404)
  }
  const token = await createSession(db, {
    address,
    audience: 'operator',
    issuerId: parsed.output.issuerId,
    now: c.get('now')(),
  })
  const body: IssuerSwitchResponse = { operator: await meResponse(c, parsed.output.issuerId), token }
  return jsonResponse(c, body)
})

issuersRoutes.put('/issuers/me', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(IssuerUpdateBody, body)
  if (!parsed.success) {
    return errorResponse(c, 'bad_input', 400)
  }
  const { issuerId } = c.get('operator')
  if (issuerId === null) {
    return errorResponse(c, 'not_found', 404)
  }
  const updated = await c
    .get('db')
    .update(issuers)
    .set(parsed.output)
    .where(eq(issuers.id, issuerId))
    .returning()
    .get()
  return updated === undefined
    ? errorResponse(c, 'not_found', 404)
    : jsonResponse(c, { issuer: issuerView(updated, c.env.API_BASE_URL) })
})

issuersRoutes.put(
  '/issuers/me/default-card',
  async (c, next) => {
    c.header('cache-control', 'no-store')
    await next()
  },
  operatorAuth(),
  async (c) => {
    const body: unknown = await c.req.json().catch(() => null)
    const parsed = v.safeParse(DefaultCardBody, body)
    if (!parsed.success) {
      return errorResponse(c, 'bad_input', 400)
    }
    const found = await ownedVenue(c.get('db'), c.get('operator').issuerId)
    if (
      found === null ||
      (parsed.output.slug !== null && !found.cards.some((card) => card.slug === parsed.output.slug))
    ) {
      return errorResponse(c, 'not_found', 404)
    }
    const updated = await c
      .get('db')
      .update(issuers)
      .set({ defaultCardSlug: parsed.output.slug })
      .where(eq(issuers.id, found.issuer.id))
      .returning()
      .get()
    return updated === undefined
      ? errorResponse(c, 'not_found', 404)
      : jsonResponse(c, { issuer: issuerView(updated, c.env.API_BASE_URL) })
  },
)

// Session-gated so the handle space cannot be enumerated anonymously.
issuersRoutes.get('/issuers/check', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const handle = c.req.query('handle') ?? ''
  const valid = isIssuerHandle(handle)
  const taken = valid
    ? (await c.get('db').select({ id: issuers.id }).from(issuers).where(eq(issuers.handle, handle)).get()) !==
      undefined
    : false
  return jsonResponse(c, { available: valid && !taken, handle, valid })
})

// Whether the operator's venue can still take this card slug.
issuersRoutes.get('/issuers/cards/check', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const slug = c.req.query('slug') ?? ''
  const { issuerId } = c.get('operator')
  const valid = isCardSlug(slug)
  const taken =
    valid && issuerId !== null
      ? (await c
          .get('db')
          .select({ id: cards.id })
          .from(cards)
          .where(and(eq(cards.issuerId, issuerId), eq(cards.slug, slug)))
          .get()) !== undefined
      : false
  return jsonResponse(c, { available: valid && !taken, slug, valid })
})

// Creates an issuer — the account's first or another one. The first binds the
// session that created it; another one answers a new session token bound to
// it. Cards are published separately, and claiming the venue's ENS name is
// optional.
const ISSUERS_PER_ACCOUNT = 10

issuersRoutes.post('/issuers', operatorAuth(), async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(IssuerCreateBody, body)
  if (!parsed.success) {
    return errorResponse(c, fieldErrorFor(parsed.issues, 'handle', 'bad_handle'), 400)
  }
  const db = c.get('db')
  const operator = c.get('operator')
  const [owned, taken] = await Promise.all([
    issuersOwnedBy(db, operator.address),
    db.select({ id: issuers.id }).from(issuers).where(eq(issuers.handle, parsed.output.handle)).get(),
  ])
  // An account may own several issuers, up to a cap that keeps one account
  // from reserving handles in bulk.
  if (owned.length >= ISSUERS_PER_ACCOUNT) {
    return errorResponse(c, 'issuer_limit', 409)
  }
  if (taken !== undefined) {
    return errorResponse(c, 'handle_taken', 409)
  }
  // A session with no issuer yet is bound to this one. A session that already
  // acts for an issuer keeps it, and the new issuer gets a session of its own.
  const bindSession = operator.issuerId === null
  let issuerId: string
  try {
    issuerId = await insertIssuer(db, operator, parsed.output, c.get('now')(), bindSession)
  } catch {
    // The unique indexes are the last word when two requests race the checks above.
    return errorResponse(c, 'handle_taken', 409)
  }
  const found = await venueOf(db, parsed.output.handle)
  if (found === null) {
    return errorResponse(c, 'internal', 500)
  }
  const created: IssuerCreateResponse = {
    cards: [],
    ens: await ensView(c, found.issuer.handle),
    issuer: issuerView(found.issuer, c.env.API_BASE_URL),
    publicUrl: publicUrlFor(c.env.PUBLIC_BASE_URL, found.issuer.handle),
  }
  // Two creates from one session with no issuer can race; only the first binds
  // it, and the other is answered a session of its own like any additional one.
  const bound = bindSession && (await sessionIssuerId(db, operator.tokenHash)) === issuerId
  if (!bound) {
    created.token = await createSession(db, {
      address: operator.address,
      audience: 'operator',
      issuerId: found.issuer.id,
      now: c.get('now')(),
    })
  }
  return jsonResponse(c, created, 201)
})

// Adds a card to the operator's existing venue. The venue itself, its handle
// and its brand colour are unchanged; only the card is new. The venue's ENS
// name plays no part: a card is published whether or not it was claimed.
issuersRoutes.post('/issuers/cards', operatorAuth(), async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(CardBody, body)
  if (!parsed.success) {
    return errorResponse(c, fieldErrorFor(parsed.issues, 'slug', 'bad_slug'), 400)
  }
  const { issuerId } = c.get('operator')
  if (issuerId === null) {
    return errorResponse(c, 'not_found', 404)
  }
  const db = c.get('db')
  const issuer = await db.select().from(issuers).where(eq(issuers.id, issuerId)).get()
  if (issuer === undefined) {
    return errorResponse(c, 'not_found', 404)
  }
  const card = await insertCard(db, issuerId, parsed.output, c.get('now')())
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

// Public: the venue page at /@<handle>, with every card it publishes. A member
// app opens the only card directly and asks the member to choose when there
// are several. The operator address is never part of this answer.
issuersRoutes.get('/issuers/:handle', async (c) => {
  c.header('cache-control', 'no-store')
  const handle = c.req.param('handle')
  const found = isIssuerHandle(handle) ? await venueOf(c.get('db'), handle) : null
  if (found === null) {
    return errorResponse(c, 'not_found', 404)
  }
  const enabledByCard = await badgeKindsByCard(
    c.get('db'),
    found.cards.map((card) => card.id),
  )
  return jsonResponse(
    c,
    publicVenue(
      found.issuer,
      found.cards,
      c.get('now')(),
      c.env.API_BASE_URL,
      configuredBadgeKinds(c.env),
      enabledByCard,
    ),
  )
})

issuersRoutes.route('/', selfServeIssueRoutes)
