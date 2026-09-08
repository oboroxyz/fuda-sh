import {
  generateMemberNumber,
  isCardSlug,
  isClaimable,
  isIssuerHandle,
  entitlementWindow,
  USAGE_MODEL,
} from '@fuda/sdk'
import type { IssueRequest, SelfServeIssueResponse } from '@fuda/sdk'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'

import { ChainError, NoSignerError } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { members } from '../db/schema.ts'
import { mirrorMemberName } from '../ens/mirror.ts'
import type { AppEnv } from '../env.ts'
import { issueBearer, IssueConfigError } from '../issue/issue-bearer.ts'
import { issueContext } from '../issue/issue-context.ts'
import { venueOf } from '../issuers/queries.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { rateLimit } from '../middleware/rate-limit.ts'

// Self-serve issuances per IP per hour: a venue's whole queue is a handful of
// phones, each of which needs one card.
export const SELF_SERVE_BUDGET = 20
const MEMBER_NUMBER_DRAWS = 3

export const selfServeIssueRoutes = new Hono<AppEnv>()

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
selfServeIssueRoutes.post(
  '/issuers/:handle/:slug/issue',
  rateLimit({ budget: SELF_SERVE_BUDGET }),
  async (c) => {
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
  },
)
