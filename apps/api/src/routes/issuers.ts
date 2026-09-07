import { generateMemberNumber, isIssuerHandle, IssuerCreateBody, USAGE_MODEL } from '@fuda/sdk'
import type { IssueRequest, IssuerCreateRequest, SelfServeIssueResponse } from '@fuda/sdk'
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
import { cardView, issuerView, publicCard, publicUrlFor } from '../issuers/views.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'
import { rateLimit } from '../middleware/rate-limit.ts'

// Self-serve issuances per IP per hour: a venue's whole queue is a handful of
// phones, each of which needs one card.
export const SELF_SERVE_BUDGET = 20
const DAY = 86_400
const MEMBER_NUMBER_DRAWS = 3

export const issuersRoutes = new Hono<AppEnv>()

const issuerWithCard = async (db: Db, handle: string) => {
  const issuer = await db.select().from(issuers).where(eq(issuers.handle, handle)).get()
  if (issuer === undefined) {
    return null
  }
  const card = await db
    .select()
    .from(cards)
    .where(eq(cards.issuerId, issuer.id))
    .orderBy(cards.createdAt)
    .get()
  return card === undefined ? null : { card, issuer }
}

const mine = async (c: Context<AppEnv>) => {
  const { issuerId } = c.get('operator')
  if (issuerId === null) {
    return null
  }
  const issuer = await c.get('db').select().from(issuers).where(eq(issuers.id, issuerId)).get()
  return issuer === undefined ? null : await issuerWithCard(c.get('db'), issuer.handle)
}

issuersRoutes.get('/issuers/me', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const found = await mine(c)
  if (found === null) {
    return jsonResponse(c, { card: null, issuer: null, publicUrl: null })
  }
  return jsonResponse(c, {
    card: cardView(found.card),
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

const insertIssuerAndCard = async (
  c: Context<AppEnv>,
  input: IssuerCreateRequest,
): Promise<{ cardId: string; issuerId: string }> => {
  const db = c.get('db')
  const operator = c.get('operator')
  const now = c.get('now')()
  const issuerId = crypto.randomUUID()
  const cardId = crypto.randomUUID()
  await db.batch([
    db.insert(issuers).values({
      brandColor: input.brandColor.toUpperCase(),
      createdAt: now,
      handle: input.handle,
      id: issuerId,
      name: input.name,
      operatorAddress: operator.address,
      tagline: input.tagline,
    }),
    db.insert(cards).values({
      category: input.card.category,
      createdAt: now,
      id: cardId,
      issuerId,
      lockScreen: input.card.lockScreen ? 1 : 0,
      perk: input.card.perk,
      reward: input.card.reward,
      title: input.card.title,
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
  const found = await issuerWithCard(db, parsed.output.handle)
  if (found === null) {
    return errorResponse(c, 'internal', 500)
  }
  return jsonResponse(
    c,
    {
      card: cardView(found.card),
      issuer: issuerView(found.issuer),
      publicUrl: publicUrlFor(c.env.PUBLIC_BASE_URL, found.issuer.handle),
    },
    201,
  )
})

// Public: what the member sees at /@<handle> before asking for a card.
issuersRoutes.get('/issuers/:handle', async (c) => {
  c.header('cache-control', 'no-store')
  const handle = c.req.param('handle')
  const found = isIssuerHandle(handle) ? await issuerWithCard(c.get('db'), handle) : null
  if (found === null) {
    return errorResponse(c, 'not_found', 404)
  }
  return jsonResponse(c, publicCard(found.issuer, found.card))
})

// A member number nobody holds under this card yet. Collisions are a 28^-12
// event; the re-draw only guards the unique index from ever turning a
// successful attest into an orphan.
const freshMemberNumber = async (db: Db, cardId: string): Promise<string | null> => {
  const candidates = Array.from({ length: MEMBER_NUMBER_DRAWS }, () => generateMemberNumber())
  const taken = await db
    .select({ memberId: members.memberId })
    .from(members)
    .where(and(eq(members.cardId, cardId), inArray(members.memberId, candidates)))
  const used = new Set(taken.map((row) => row.memberId))
  return candidates.find((candidate) => !used.has(candidate)) ?? null
}

// Self-serve Bearer issuance (docs/specs/pass-types-and-flows.md#u1-standard-issuance-and-optional-activation):
// no body, no account. The card fixes tier, usage model and validity.
issuersRoutes.post('/issuers/:handle/issue', rateLimit({ budget: SELF_SERVE_BUDGET }), async (c) => {
  c.header('cache-control', 'no-store')
  const handle = c.req.param('handle')
  const found = isIssuerHandle(handle) ? await issuerWithCard(c.get('db'), handle) : null
  if (found === null) {
    return errorResponse(c, 'not_found', 404)
  }
  if (c.get('chain').signerAddress() === null) {
    return errorResponse(c, 'no_signer', 501)
  }
  const ctx = issueContext(c)
  if (ctx === null) {
    return errorResponse(c, 'chain_error', 502)
  }
  const memberNumber = await freshMemberNumber(ctx.db, found.card.id)
  if (memberNumber === null) {
    return errorResponse(c, 'internal', 500)
  }
  const { validityDays } = found.card
  const body: IssueRequest & { memberId: string } = {
    memberId: memberNumber,
    metaURI: '',
    tier: 0,
    usageModel: found.card.category === 'ticket' ? USAGE_MODEL.SINGLE_USE : USAGE_MODEL.MULTI_USE,
    validFrom: 0,
    validUntil: validityDays === null ? 0 : ctx.now + validityDays * DAY,
  }
  try {
    const issued = await issueBearer(ctx, body, found.card.id)
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
