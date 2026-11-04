import { ClaimSource, isCardSlugReference, isClaimable, isIssuerHandle } from '@fuda/sdk'
import * as v from 'valibot'
import { defineHandler } from 'void'

import { issueForCard } from '../issue/issue-for-card.ts'
import type { CardIssueError } from '../issue/issue-for-card.ts'
import { venueOf } from '../issuers/queries.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { rateLimit } from '../middleware/rate-limit.ts'
import { verifyTurnstile } from '../turnstile/siteverify.ts'

// Self-serve issuances per IP per hour: a venue's whole queue is a handful of
// phones, each of which needs one card.
const SELF_SERVE_BUDGET = 20

const STATUS = {
  card_sold_out: 409,
  chain_error: 502,
  internal: 500,
  no_signer: 501,
} as const satisfies Record<CardIssueError, number>

// Self-serve Bearer issuance (docs/specs/pass-types-and-flows.md#u1-standard-issuance-and-optional-activation):
// no account, and a body only to say which link the claim came through. A label
// that fails the rule is dropped, so a mangled link still gets a person their pass.
const ClaimBody = v.object({ source: ClaimSource })

// Read apart from the source so a mangled label never costs the member their token.
const ClaimToken = v.object({ turnstileToken: v.string() })

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
    const json = await c.req.json().catch(() => null)
    // The one bot check for every claim of this route, whatever the card type. It
    // runs before any place is reserved. Without a secret the deployment has
    // not opted in, which is how local development and the tests run.
    const secret = c.env.TURNSTILE_SECRET_KEY
    if (secret !== undefined && secret !== '') {
      const token = v.safeParse(ClaimToken, json)
      const verdict = await verifyTurnstile({
        // rateLimit has already refused a request without this header.
        ip: c.req.header('CF-Connecting-IP') ?? '',
        secret,
        token: token.success ? token.output.turnstileToken : null,
      })
      if (verdict === 'failed') {
        return errorResponse(c, 'bot_check_failed', 403)
      }
      if (verdict === 'unavailable') {
        return errorResponse(c, 'bot_check_unavailable', 503)
      }
    }
    const body = v.safeParse(ClaimBody, json)
    const outcome = await issueForCard(c, card, venue.issuer, body.success ? body.output.source : null)
    return outcome.ok ? jsonResponse(c, outcome.pass) : errorResponse(c, outcome.error, STATUS[outcome.error])
  },
)
