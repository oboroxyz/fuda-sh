import {
  asHex,
  CardBody,
  entitlementWindow,
  generateMemberNumber,
  isClaimable,
  isCardSlug,
  isIssuerHandle,
  IssuerCreateBody,
  USAGE_MODEL,
} from '@fuda/sdk'
import type { EnsClaimView, IssueRequest, IssuerMeResponse, SelfServeIssueResponse } from '@fuda/sdk'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import * as v from 'valibot'

import { ChainError, NoSignerError } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { cards, issuers, members } from '../db/schema.ts'
import { mirrorMemberName } from '../ens/mirror.ts'
import { issuerEnsName } from '../ens/names.ts'
import { ensNames } from '../ens/schema.ts'
import type { AppEnv } from '../env.ts'
import { issueBearer, IssueConfigError } from '../issue/issue-bearer.ts'
import { issueContext } from '../issue/issue-context.ts'
import { insertCard, insertIssuerAndCard } from '../issuers/create.ts'
import { ownedVenue, venueOf } from '../issuers/queries.ts'
import { cardView, issuerView, publicUrlFor, publicVenue } from '../issuers/views.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { operatorAuth } from '../middleware/operator-auth.ts'
import { rateLimit } from '../middleware/rate-limit.ts'

// Self-serve issuances per IP per hour: a venue's whole queue is a handful of
// phones, each of which needs one card.
export const SELF_SERVE_BUDGET = 20
const MEMBER_NUMBER_DRAWS = 3

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

issuersRoutes.get('/issuers/me', operatorAuth(), async (c) => {
  c.header('cache-control', 'no-store')
  const found = await ownedVenue(c.get('db'), c.get('operator').issuerId)
  if (found === null) {
    const empty: IssuerMeResponse = { cards: [], ens: null, issuer: null, publicUrl: null }
    return jsonResponse(c, empty)
  }
  const body: IssuerMeResponse = {
    cards: found.cards.map((card) => cardView(card, c.get('now')())),
    ens: await ensView(c, found.issuer.handle),
    issuer: issuerView(found.issuer, c.env.API_BASE_URL),
    publicUrl: publicUrlFor(c.env.PUBLIC_BASE_URL, found.issuer.handle),
  }
  return jsonResponse(c, body)
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

// Which field a failed parse should be reported as. The valibot issues already
// name the failing key, so the body is never re-parsed against a shadow schema
// to find out. Only the name rule's own `check` earns the field's code
// (docs/specs/attestation-model.md): a missing or non-string field fails the
// string schema first and stays bad_input, as it did before.
const fieldErrorFor = (
  issues: readonly v.BaseIssue<unknown>[],
  field: string,
  code: 'bad_handle' | 'bad_slug',
): 'bad_handle' | 'bad_slug' | 'bad_input' =>
  issues.some(
    (issue) => issue.type === 'check' && issue.path?.some((segment) => segment.key === field) === true,
  )
    ? code
    : 'bad_input'

// Creates the issuer and its first card in one batch and binds the session to
// it. One issuer per operator address in this slice.
issuersRoutes.post('/issuers', operatorAuth(), async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = v.safeParse(IssuerCreateBody, body)
  if (!parsed.success) {
    return errorResponse(c, fieldErrorFor(parsed.issues, 'handle', 'bad_handle'), 400)
  }
  const db = c.get('db')
  const operator = c.get('operator')
  if (operator.issuerId !== null) {
    return errorResponse(c, 'issuer_exists', 409)
  }
  const [owned, taken] = await Promise.all([
    db.select({ id: issuers.id }).from(issuers).where(eq(issuers.operatorAddress, operator.address)).get(),
    db.select({ id: issuers.id }).from(issuers).where(eq(issuers.handle, parsed.output.handle)).get(),
  ])
  if (owned !== undefined) {
    return errorResponse(c, 'issuer_exists', 409)
  }
  if (taken !== undefined) {
    return errorResponse(c, 'handle_taken', 409)
  }
  try {
    await insertIssuerAndCard(db, operator, parsed.output, c.get('now')())
  } catch {
    // The unique indexes are the last word when two requests race the checks above.
    return errorResponse(c, 'handle_taken', 409)
  }
  const found = await venueOf(db, parsed.output.handle)
  const created = found?.cards[0]
  if (found === null || created === undefined) {
    return errorResponse(c, 'internal', 500)
  }
  return jsonResponse(
    c,
    {
      card: cardView(created, c.get('now')()),
      issuer: issuerView(found.issuer, c.env.API_BASE_URL),
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
  return jsonResponse(c, publicVenue(found.issuer, found.cards, c.get('now')(), c.env.API_BASE_URL))
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
    // The member's own name under the venue. Best-effort by design: a name that
    // failed to mirror costs a resolution, not a card (apps/api/src/ens/mirror.ts).
    if (c.env.ENS_PARENT_NAME !== undefined) {
      await mirrorMemberName(ctx.db, {
        holder: issued.holder,
        issuerHandle: found.issuer.handle,
        level: 'bearer',
        memberNumber,
        now: ctx.now,
        parentName: c.env.ENS_PARENT_NAME,
        rightUid: issued.uid,
        stealthMetaAddress: null,
      })
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
