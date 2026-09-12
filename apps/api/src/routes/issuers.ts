import {
  asHex,
  CardBody,
  DefaultCardBody,
  isCardSlug,
  isIssuerHandle,
  IssuerCreateBody,
  IssuerUpdateBody,
} from '@fuda/sdk'
import type { EnsClaimView, IssuerMeResponse } from '@fuda/sdk'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import * as v from 'valibot'

import { cards, issuers } from '../db/schema.ts'
import { issuerEnsName } from '../ens/names.ts'
import { ensNames } from '../ens/schema.ts'
import type { AppEnv } from '../env.ts'
import { insertCard, insertIssuer } from '../issuers/create.ts'
import { ownedVenue, venueOf } from '../issuers/queries.ts'
import { cardView, issuerView, publicUrlFor, publicVenue } from '../issuers/views.ts'
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

// Creates the issuer and binds the session to it in one batch. Cards are
// published separately after ENS claim confirmation.
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
    await insertIssuer(db, operator, parsed.output, c.get('now')())
  } catch {
    // The unique indexes are the last word when two requests race the checks above.
    return errorResponse(c, 'handle_taken', 409)
  }
  const found = await venueOf(db, parsed.output.handle)
  if (found === null) {
    return errorResponse(c, 'internal', 500)
  }
  return jsonResponse(
    c,
    {
      cards: [],
      ens: await ensView(c, found.issuer.handle),
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
  const ens = await ensView(c, issuer.handle)
  if (ens === null) {
    return errorResponse(c, 'ens_not_configured', 503)
  }
  if (ens.status !== 'claimed') {
    return errorResponse(c, 'ens_required', 409)
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

issuersRoutes.route('/', selfServeIssueRoutes)
