import {
  ClaimSource,
  claimMessage,
  ADDRESS_RE,
  UID_RE,
  isCardSlugReference,
  isClaimable,
  isIssuerHandle,
  PasskeyClaimBody,
  SensitiveClaimBody,
} from '@fuda/sdk'
import type { Context } from 'hono'
import * as v from 'valibot'
import { getAddress, recoverMessageAddress, isAddressEqual } from 'viem'
import { defineHandler } from 'void'

import { claimingPasskey, relyingParty } from '../auth/passkey.ts'
import type { cards } from '../db/schema.ts'
import { cardApplicants } from '../db/schema.ts'
import type { AppEnv } from '../env.ts'
import { issueForCard } from '../issue/issue-for-card.ts'
import type { CardIssueError } from '../issue/issue-for-card.ts'
import type { PassClaimant } from '../issue/issue-offchain.ts'
import { venueOf } from '../issuers/queries.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { memberBearerSession } from '../middleware/bearer-session.ts'
import { rateLimit } from '../middleware/rate-limit.ts'
import { existingAddressPass } from '../requirements/claim.ts'
import { requirementsOf } from '../requirements/store.ts'
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
type Claim = { ok: true; claimant: PassClaimant; agreementId?: `0x${string}` } | { ok: false; res: Response }

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

const AddressClaimBody = v.object({
  agreementId: v.optional(v.pipe(v.string(), v.regex(UID_RE))),
  holderAddress: v.pipe(v.string(), v.regex(ADDRESS_RE)),
  signature: v.string(),
})

const addressClaimant = async (
  c: Context<AppEnv>,
  cardId: string,
  body: v.SafeParseResult<typeof AddressClaimBody>,
): Promise<Claim> => {
  if (!body.success) {
    const absent =
      body.issues.some(
        (issue) =>
          issue.path?.some((entry) => entry.key === 'holderAddress') === true && issue.input === undefined,
      ) &&
      body.issues.some(
        (issue) =>
          issue.path?.some((entry) => entry.key === 'signature') === true && issue.input === undefined,
      )
    return {
      ok: false,
      res: errorResponse(c, absent ? 'holder_must_claim' : 'bad_input', absent ? 409 : 400),
    }
  }
  const address = getAddress(body.output.holderAddress)
  try {
    const recovered = await recoverMessageAddress({
      message: claimMessage(cardId, address),
      signature: `0x${body.output.signature.slice(2)}`,
    })
    if (isAddressEqual(address, recovered)) {
      return {
        agreementId:
          body.output.agreementId === undefined ? undefined : `0x${body.output.agreementId.slice(2)}`,
        claimant: { address, kind: 'address' },
        ok: true,
      }
    }
  } catch {
    return { ok: false, res: errorResponse(c, 'bad_signature', 403) }
  }
  return { ok: false, res: errorResponse(c, 'bad_signature', 403) }
}

const claimFor = async (
  c: Context<AppEnv>,
  card: Pick<typeof cards.$inferSelect, 'identity' | 'hasRequirements'>,
  cardId: string,
  body: {
    address: v.SafeParseResult<typeof AddressClaimBody>
    passkey: v.SafeParseResult<typeof PasskeyClaimBody>
    sensitive: v.SafeParseResult<typeof SensitiveClaimBody>
  },
): Promise<Claim | null> => {
  if (card.hasRequirements) {
    return await addressClaimant(c, cardId, body.address)
  }
  if (card.identity === 'passkey') {
    return await passkeyClaimant(c, body.passkey)
  }
  return card.identity === 'sensitive' ? sensitiveClaimant(c, body.sensitive) : null
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

const requestedCard = async (c: Context<AppEnv>) => {
  c.header('cache-control', 'no-store')
  const { handle, slug } = c.req.param()
  const venue =
    isIssuerHandle(handle) && isCardSlugReference(slug) ? await venueOf(c.get('db'), handle) : null
  const card = venue?.cards.find((entry) => entry.slug === slug)
  return venue === null || card === undefined ? null : { card, issuer: venue.issuer }
}

const claimRequest = async (
  c: Context<AppEnv>,
  card: Parameters<typeof isClaimable>[0],
  restoring = false,
) => {
  if (!restoring && !isClaimable(card, c.get('now')())) {
    return { ok: false, res: errorResponse(c, 'card_closed', 409) } as const
  }
  const raw: unknown = await c.req.json().catch(() => null)
  const token = v.safeParse(ClaimToken, raw)
  const refused = await botCheck(c, token.success ? token.output.turnstileToken : null)
  return refused === null ? ({ ok: true, raw } as const) : ({ ok: false, res: refused } as const)
}

export const postV1IssuersHandleSlugIssue = defineHandler(
  rateLimit({ budget: SELF_SERVE_BUDGET }),
  async (c) => {
    const found = await requestedCard(c)
    if (found === null) {
      return errorResponse(c, 'not_found', 404)
    }
    const { card, issuer } = found
    const request = await claimRequest(c, card, card.hasRequirements)
    if (!request.ok) {
      return request.res
    }
    const { raw } = request
    const body = v.safeParse(ClaimBody, raw)
    const claim = await claimFor(c, card, card.id, {
      address: v.safeParse(AddressClaimBody, raw),
      passkey: v.safeParse(PasskeyClaimBody, raw),
      sensitive: v.safeParse(SensitiveClaimBody, raw),
    })
    if (claim !== null && !claim.ok) {
      return claim.res
    }
    if (card.hasRequirements && !isClaimable(card, c.get('now')())) {
      const existing =
        claim?.claimant.kind === 'address'
          ? await existingAddressPass(c.get('db'), card.id, claim.claimant.address, c.env.API_BASE_URL)
          : null
      if (existing === null) {
        return errorResponse(c, 'card_closed', 409)
      }
    }
    const outcome = await issueForCard(
      c,
      card,
      issuer,
      body.success ? body.output.source : null,
      claim?.claimant ?? null,
      claim?.agreementId,
    )
    if (!outcome.ok && outcome.error === 'requirement_unmet') {
      return jsonResponse(c, { error: outcome.error, requirement: outcome.requirement }, 403)
    }
    return outcome.ok ? jsonResponse(c, outcome.pass) : errorResponse(c, outcome.error, STATUS[outcome.error])
  },
)

export const postV1IssuersHandleSlugApply = defineHandler(
  rateLimit({ budget: SELF_SERVE_BUDGET }),
  async (c) => {
    const found = await requestedCard(c)
    const requirements = found === null ? [] : await requirementsOf(c.get('db'), found.card)
    if (found === null || requirements.length === 0) {
      return errorResponse(c, 'not_found', 404)
    }
    const { card } = found
    const request = await claimRequest(c, card)
    if (!request.ok) {
      return request.res
    }
    const { raw } = request
    const body = v.safeParse(SensitiveClaimBody, raw)
    if (!body.success) {
      return errorResponse(c, 'bad_input', 400)
    }
    await c
      .get('db')
      .insert(cardApplicants)
      .values({
        address: body.output.holderAddress.toLowerCase(),
        appliedAt: c.get('now')(),
        cardId: card.id,
      })
      .onConflictDoNothing()
    return jsonResponse(c, { applied: true })
  },
)
