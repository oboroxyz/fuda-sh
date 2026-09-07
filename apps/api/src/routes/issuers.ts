import {
  CardBody,
  entitlementWindow,
  generateMemberNumber,
  isClaimable,
  isCardSlug,
  isIssuerHandle,
  IssuerCreateBody,
  USAGE_MODEL,
} from '@fuda/sdk'
import type { CardRequest, IssueRequest, IssuerCreateRequest, SelfServeIssueResponse } from '@fuda/sdk'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import * as v from 'valibot'

import { attachIssuer } from '../auth/session.ts'
import { ChainError, NoSignerError } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { cards, issuers, members } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { issueBearer, IssueConfigError } from '../issue/issue-bearer.ts'
import { issueContext } from '../issue/issue-context.ts'
import { cardView, issuerView, publicUrlFor, publicVenue } from '../issuers/views.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { claimLogoUpload } from '../media/store.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'
import { rateLimit } from '../middleware/rate-limit.ts'

// Self-serve issuances per IP per hour: a venue's whole queue is a handful of
// phones, each of which needs one card.
export const SELF_SERVE_BUDGET = 20
const MEMBER_NUMBER_DRAWS = 3

export const issuersRoutes = new Hono<AppEnv>()

// The venue behind a handle with every card it has published, oldest first.
const venueOf = async (db: Db, handle: string) => {
  const issuer = await db.select().from(issuers).where(eq(issuers.handle, handle)).get()
  if (issuer === undefined) {
    return null
  }
  const owned = await db.select().from(cards).where(eq(cards.issuerId, issuer.id)).orderBy(cards.createdAt)
  return owned.length === 0 ? null : { cards: owned, issuer }
}

// Every card the venue has published, oldest first. The member-facing reads
// take one card; the operator sees the whole list.
const mine = async (c: Context<AppEnv>) => {
  const { issuerId } = c.get('operator')
  if (issuerId === null) {
    return null
  }
  const db = c.get('db')
  const issuer = await db.select().from(issuers).where(eq(issuers.id, issuerId)).get()
  if (issuer === undefined) {
    return null
  }
  return await venueOf(db, issuer.handle)
}

issuersRoutes.get('/issuers/me', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const found = await mine(c)
  if (found === null) {
    return jsonResponse(c, { cards: [], issuer: null, publicUrl: null })
  }
  return jsonResponse(c, {
    cards: found.cards.map((card) => cardView(card, c.get('now')())),
    issuer: issuerView(found.issuer),
    publicUrl: publicUrlFor(c.env.PUBLIC_BASE_URL, found.issuer.handle),
  })
})

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

// One card row. Returns null when the venue already publishes that slug; the
// unique index is the arbiter, so a race loses here rather than half-writing.
const insertCard = async (
  c: Context<AppEnv>,
  issuerId: string,
  input: CardRequest,
): Promise<typeof cards.$inferSelect | null> => {
  const db = c.get('db')
  const id = crypto.randomUUID()
  try {
    await db.insert(cards).values({
      category: input.category,
      claimFrom: input.claimFrom,
      claimUntil: input.claimUntil,
      createdAt: c.get('now')(),
      id,
      issuerId,
      lockScreen: input.lockScreen ? 1 : 0,
      perk: input.perk,
      reward: input.reward,
      slug: input.slug,
      title: input.title,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      validityDays: input.validityDays,
      venueLat: input.venue?.lat ?? null,
      venueLng: input.venue?.lng ?? null,
    })
  } catch {
    return null
  }
  return (await db.select().from(cards).where(eq(cards.id, id)).get()) ?? null
}

const insertIssuerAndCard = async (
  c: Context<AppEnv>,
  input: IssuerCreateRequest,
): Promise<{ cardId: string; issuerId: string }> => {
  const db = c.get('db')
  const operator = c.get('operator')
  const now = c.get('now')()
  const issuerId = crypto.randomUUID()
  const cardId = crypto.randomUUID()
  // A logo staged before the venue existed is claimed here; an id that is
  // unknown, spent or someone else's simply leaves the venue unbranded rather
  // than failing a create the operator cannot retry.
  const logoPrefix =
    input.logoUploadId === null
      ? null
      : await claimLogoUpload(db, { id: input.logoUploadId, now, sessionTokenHash: operator.tokenHash })
  await db.batch([
    db.insert(issuers).values({
      brandColor: input.brandColor.toUpperCase(),
      createdAt: now,
      handle: input.handle,
      id: issuerId,
      logoPrefix,
      name: input.name,
      operatorAddress: operator.address,
      tagline: input.tagline,
    }),
    db.insert(cards).values({
      category: input.card.category,
      claimFrom: input.card.claimFrom,
      claimUntil: input.card.claimUntil,
      createdAt: now,
      id: cardId,
      issuerId,
      lockScreen: input.card.lockScreen ? 1 : 0,
      perk: input.card.perk,
      reward: input.card.reward,
      slug: input.card.slug,
      title: input.card.title,
      validFrom: input.card.validFrom,
      validUntil: input.card.validUntil,
      validityDays: input.card.validityDays,
      venueLat: input.card.venue?.lat ?? null,
      venueLng: input.card.venue?.lng ?? null,
    }),
  ])
  await attachIssuer(db, operator.tokenHash, issuerId)
  return { cardId, issuerId }
}

// Creates the issuer and its first card in one batch and binds the session to
// it. One issuer per operator address in this slice.
issuersRoutes.post('/issuers', operatorAuth(), async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(IssuerCreateBody, body)
  if (!parsed.success) {
    const handleOnly = v.safeParse(v.object({ handle: v.string() }), body)
    return errorResponse(
      c,
      handleOnly.success && !isIssuerHandle(handleOnly.output.handle) ? 'bad_handle' : 'bad_input',
      400,
    )
  }
  const db = c.get('db')
  const operator = c.get('operator')
  if (operator.issuerId !== null) {
    return errorResponse(c, 'issuer_exists', 409)
  }
  const owned = await db
    .select({ id: issuers.id })
    .from(issuers)
    .where(eq(issuers.operatorAddress, operator.address))
    .get()
  if (owned !== undefined) {
    return errorResponse(c, 'issuer_exists', 409)
  }
  const taken = await db
    .select({ id: issuers.id })
    .from(issuers)
    .where(eq(issuers.handle, parsed.output.handle))
    .get()
  if (taken !== undefined) {
    return errorResponse(c, 'handle_taken', 409)
  }
  try {
    await insertIssuerAndCard(c, parsed.output)
  } catch {
    // The unique indexes are the last word when two requests race the checks above.
    return errorResponse(c, 'handle_taken', 409)
  }
  const found = await venueOf(db, parsed.output.handle)
  const created = found?.cards[0]
  if (found === undefined || found === null || created === undefined) {
    return errorResponse(c, 'internal', 500)
  }
  return jsonResponse(
    c,
    {
      card: cardView(created, c.get('now')()),
      issuer: issuerView(found.issuer),
      publicUrl: publicUrlFor(c.env.PUBLIC_BASE_URL, found.issuer.handle),
    },
    201,
  )
})

// Adds a card to the operator's existing venue. The venue itself, its handle
// and its brand colour are unchanged; only the card is new.
issuersRoutes.post('/issuers/cards', operatorAuth(), async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(CardBody, body)
  if (!parsed.success) {
    const slugOnly = v.safeParse(v.object({ slug: v.string() }), body)
    return errorResponse(
      c,
      slugOnly.success && !isCardSlug(slugOnly.output.slug) ? 'bad_slug' : 'bad_input',
      400,
    )
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
  const card = await insertCard(c, issuerId, parsed.output)
  if (card === null) {
    return errorResponse(c, 'slug_taken', 409)
  }
  return jsonResponse(
    c,
    {
      card: cardView(card, c.get('now')()),
      issuer: issuerView(issuer),
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
  return jsonResponse(c, publicVenue(found.issuer, found.cards, c.get('now')()))
})

// A member number nobody holds at this venue yet. The scope is the issuer, not
// the card, because the number is an ENS label under the issuer
// (docs/specs/ens-naming.md#member-number). Collisions are a 28^-12 event; the
// re-draw only guards the unique index from ever turning a successful attest
// into an orphan.
const freshMemberNumber = async (db: Db, issuerId: string): Promise<string | null> => {
  const candidates = Array.from({ length: MEMBER_NUMBER_DRAWS }, () => generateMemberNumber())
  const taken = await db
    .select({ memberId: members.memberId })
    .from(members)
    .where(and(eq(members.issuerId, issuerId), inArray(members.memberId, candidates)))
  const used = new Set(taken.map((row) => row.memberId))
  return candidates.find((candidate) => !used.has(candidate)) ?? null
}

// Self-serve Bearer issuance (docs/specs/pass-types-and-flows.md#u1-standard-issuance-and-optional-activation):
// no body, no account. The card fixes tier, usage model and validity.
issuersRoutes.post('/issuers/:handle/:slug/issue', rateLimit({ budget: SELF_SERVE_BUDGET }), async (c) => {
  c.header('cache-control', 'no-store')
  const handle = c.req.param('handle')
  const slug = c.req.param('slug')
  const venue = isIssuerHandle(handle) && isCardSlug(slug) ? await venueOf(c.get('db'), handle) : null
  const card = venue?.cards.find((entry) => entry.slug === slug)
  const found =
    venue === null || venue === undefined || card === undefined ? null : { card, issuer: venue.issuer }
  if (found === null) {
    return errorResponse(c, 'not_found', 404)
  }
  // Outside its claim window a card exists but is not being handed out. Saying
  // so beats minting a right the gate would only ever reject, at the signer's expense.
  if (!isClaimable(found.card, c.get('now')())) {
    return errorResponse(c, 'card_closed', 409)
  }
  if (c.get('chain').signerAddress() === null) {
    return errorResponse(c, 'no_signer', 501)
  }
  const ctx = issueContext(c)
  if (ctx === null) {
    return errorResponse(c, 'chain_error', 502)
  }
  const memberNumber = await freshMemberNumber(ctx.db, found.issuer.id)
  if (memberNumber === null) {
    return errorResponse(c, 'internal', 500)
  }
  const window = entitlementWindow(found.card, ctx.now)
  const body: IssueRequest & { memberId: string } = {
    memberId: memberNumber,
    metaURI: '',
    tier: 0,
    usageModel: found.card.category === 'ticket' ? USAGE_MODEL.SINGLE_USE : USAGE_MODEL.MULTI_USE,
    validFrom: window.validFrom,
    validUntil: window.validUntil,
  }
  try {
    const issued = await issueBearer(ctx, body, { cardId: found.card.id, issuerId: found.issuer.id })
    if (issued.level === 'private') {
      return errorResponse(c, 'internal', 500)
    }
    const response: SelfServeIssueResponse = { ...issued, level: 'bearer', memberNumber }
    return jsonResponse(c, response)
  } catch (error) {
    if (error instanceof NoSignerError) {
      return errorResponse(c, 'no_signer', 501)
    }
    if (error instanceof ChainError || error instanceof IssueConfigError) {
      return errorResponse(c, 'chain_error', 502)
    }
    throw error
  }
})
