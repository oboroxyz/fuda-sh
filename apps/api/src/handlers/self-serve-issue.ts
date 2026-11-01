import { isCardSlugReference, isClaimable, isIssuerHandle } from '@fuda/sdk'
import { defineHandler } from 'void'

import { issueForCard } from '../issue/issue-for-card.ts'
import type { CardIssueError } from '../issue/issue-for-card.ts'
import { venueOf } from '../issuers/queries.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { rateLimit } from '../middleware/rate-limit.ts'

// Self-serve issuances per IP per hour: a venue's whole queue is a handful of
// phones, each of which needs one card.
export const SELF_SERVE_BUDGET = 20

const STATUS = { chain_error: 502, internal: 500, no_signer: 501 } as const satisfies Record<
  CardIssueError,
  number
>

// Self-serve Bearer issuance (docs/specs/pass-types-and-flows.md#u1-standard-issuance-and-optional-activation):
// no body, no account.
export const postV1IssuersHandleSlugIssue = defineHandler(
  rateLimit({ budget: SELF_SERVE_BUDGET }),
  async (c) => {
    c.header('cache-control', 'no-store')
    const { handle, slug } = c.req.param()
    const venue =
      isIssuerHandle(handle) && isCardSlugReference(slug) ? await venueOf(c.get('db'), handle) : null
    const card = venue?.cards.find((entry) => entry.slug === slug)
    if (venue === null || card === undefined) {
      return errorResponse(c, 'not_found', 404)
    }
    // Outside its claim window a card exists but is not being handed out. Saying
    // so beats minting a right the gate would only ever reject, at the signer's expense.
    if (!isClaimable(card, c.get('now')())) {
      return errorResponse(c, 'card_closed', 409)
    }
    const outcome = await issueForCard(c, card, venue.issuer)
    return outcome.ok ? jsonResponse(c, outcome.pass) : errorResponse(c, outcome.error, STATUS[outcome.error])
  },
)
