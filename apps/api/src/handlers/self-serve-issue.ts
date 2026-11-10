import {
  ClaimSource,
  isCardSlugReference,
  isClaimable,
  isIssuerHandle,
  PasskeyClaimBody,
  SensitiveClaimBody,
} from '@fuda/sdk'
import type { CardIdentity } from '@fuda/sdk'
import type { Context } from 'hono'
import * as v from 'valibot'
import { getAddress } from 'viem'
import { defineHandler } from 'void'

import { claimingPasskey, relyingParty } from '../auth/passkey.ts'
import type { AppEnv } from '../env.ts'
import { issueForCard } from '../issue/issue-for-card.ts'
import type { CardIssueError } from '../issue/issue-for-card.ts'
import type { PassClaimant } from '../issue/issue-offchain.ts'
import { venueOf } from '../issuers/queries.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { memberBearerSession } from '../middleware/bearer-session.ts'
import { rateLimit } from '../middleware/rate-limit.ts'
import { verifyTurnstile } from '../turnstile/siteverify.ts'

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

// Self-serve issuance (docs/specs/pass-types-and-flows.md#standard-issuance):
// no account, and a body only to say which link the claim came through. A label
// that fails the rule is dropped, so a mangled link still gets a person their pass.
const ClaimBody = v.object({ source: ClaimSource })

// docs/specs/pass-types-and-flows.md#claiming-an-identified-pass. A refused assertion is
// 403 and not the ceremonies' usual 401: the session is fine, and the member app's Worker
// ends a session on any 401 it forwards.
type Claim = { ok: true; claimant: PassClaimant } | { ok: false; res: Response }

const passkeyClaimant = async (
  c: Context<AppEnv>,
  body: v.SafeParseResult<typeof PasskeyClaimBody>,
): Promise<Claim> => {
  const session = await memberBearerSession(c)
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
    : { claimant: { accountId, key, kind: 'passkey' }, ok: true }
}

// docs/specs/pass-types-and-flows.md#sensitive-use. No session is read: the account behind
// this address stays out of the pass, and out of this request's handling.
const sensitiveClaimant = (c: Context<AppEnv>, body: v.SafeParseResult<typeof SensitiveClaimBody>): Claim =>
  body.success
    ? { claimant: { address: getAddress(body.output.holderAddress), kind: 'address' }, ok: true }
    : { ok: false, res: errorResponse(c, 'bad_input', 400) }

const claimFor = async (
  c: Context<AppEnv>,
  identity: CardIdentity,
  body: {
    passkey: v.SafeParseResult<typeof PasskeyClaimBody>
    sensitive: v.SafeParseResult<typeof SensitiveClaimBody>
  },
): Promise<Claim | null> => {
  if (identity === 'passkey') {
    return await passkeyClaimant(c, body.passkey)
  }
  return identity === 'sensitive' ? sensitiveClaimant(c, body.sensitive) : null
}

// Read apart from the source so a mangled label never costs the member their token.
const ClaimToken = v.object({ turnstileToken: v.string() })

// The one bot check for every claim of this route, whatever the card type. It
// runs before any place is reserved. Without a secret the deployment has not
// opted in, which is how local development and the tests run.
const botCheck = async (c: Context<AppEnv>, token: string | null): Promise<Response | null> => {
  const secret = c.env.TURNSTILE_SECRET_KEY
  if (secret === undefined || secret === '') {
    return null
  }
  const verdict = await verifyTurnstile({
    // rateLimit has already refused a request without this header.
    ip: c.req.header('CF-Connecting-IP') ?? '',
    secret,
    token,
  })
  if (verdict === 'failed') {
    return errorResponse(c, 'bot_check_failed', 403)
  }
  return verdict === 'unavailable' ? errorResponse(c, 'bot_check_unavailable', 503) : null
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
    const claimToken = v.safeParse(ClaimToken, raw)
    const refused = await botCheck(c, claimToken.success ? claimToken.output.turnstileToken : null)
    if (refused !== null) {
      return refused
    }
    const body = v.safeParse(ClaimBody, raw)
    const claim = await claimFor(c, card.identity, {
      passkey: v.safeParse(PasskeyClaimBody, raw),
      sensitive: v.safeParse(SensitiveClaimBody, raw),
    })
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
