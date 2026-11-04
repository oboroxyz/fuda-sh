import { ClaimSource, isCardSlugReference, isClaimable, isIssuerHandle, PasskeyClaimBody } from '@fuda/sdk'
import type { Context } from 'hono'
import * as v from 'valibot'
import { defineHandler } from 'void'

import { claimingPasskey, relyingParty } from '../auth/member-passkey.ts'
import type { AppEnv } from '../env.ts'
import { issueForCard } from '../issue/issue-for-card.ts'
import type { CardIssueError } from '../issue/issue-for-card.ts'
import type { PasskeyClaimant } from '../issue/issue-offchain.ts'
import { venueOf } from '../issuers/queries.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { bearerSession } from '../middleware/bearer-session.ts'
import { rateLimit } from '../middleware/rate-limit.ts'

// Self-serve issuances per IP per hour: a venue's whole queue is a handful of
// phones, each of which needs one card.
const SELF_SERVE_BUDGET = 20

const STATUS = {
  card_sold_out: 409,
  chain_error: 502,
  holder_must_claim: 409,
  internal: 500,
  no_signer: 501,
} as const satisfies Record<CardIssueError, number>

// Self-serve issuance (docs/specs/pass-types-and-flows.md#u1-standard-issuance-and-optional-activation):
// no account, and a body only to say which link the claim came through. A label
// that fails the rule is dropped, so a mangled link still gets a person their pass.
const ClaimBody = v.object({ source: ClaimSource })

// docs/specs/pass-types-and-flows.md#claiming-an-identified-pass. A refused assertion is
// 403 and not the ceremonies' usual 401: the session is fine, and the member app's Worker
// ends a session on any 401 it forwards.
const passkeyClaimant = async (
  c: Context<AppEnv>,
  body: v.SafeParseResult<typeof PasskeyClaimBody>,
): Promise<{ ok: true; claimant: PasskeyClaimant } | { ok: false; res: Response }> => {
  const session = await bearerSession(c, 'member')
  if (session.kind !== 'valid' || session.session.accountId === null) {
    return { ok: false, res: errorResponse(c, 'unauthorized', 401) }
  }
  if (!body.success) {
    return { ok: false, res: errorResponse(c, 'bad_input', 400) }
  }
  const { accountId } = session.session
  const key = await claimingPasskey(
    c.get('db'),
    relyingParty(c.env),
    accountId,
    body.output.webauthn,
    c.get('now')(),
  )
  return key === null
    ? { ok: false, res: errorResponse(c, 'bad_passkey', 403) }
    : { claimant: { accountId, key }, ok: true }
}

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
    const raw: unknown = await c.req.json().catch(() => null)
    const body = v.safeParse(ClaimBody, raw)
    const claim =
      card.identity === 'passkey' ? await passkeyClaimant(c, v.safeParse(PasskeyClaimBody, raw)) : null
    if (claim !== null && !claim.ok) {
      return claim.res
    }
    const outcome = await issueForCard(
      c,
      card,
      venue.issuer,
      body.success ? body.output.source : null,
      claim?.claimant ?? null,
    )
    return outcome.ok ? jsonResponse(c, outcome.pass) : errorResponse(c, outcome.error, STATUS[outcome.error])
  },
)
