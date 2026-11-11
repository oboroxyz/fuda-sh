import { entitlementWindow, generateMemberNumber, USAGE_MODEL } from '@fuda/sdk'
import type { RequirementUnmet, IssueRequest, SelfServeIssueResponse } from '@fuda/sdk'
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import type { Hex } from 'viem'

import { ChainError, NoSignerError } from '../chain/client.ts'
import { UnknownTransactionOutcomeError } from '../chain/unknown-transaction-outcome-error.ts'
import type { Db } from '../db/client.ts'
import { cards, members } from '../db/schema.ts'
import type { issuers } from '../db/schema.ts'
import { mirrorMemberName } from '../ens/mirror.ts'
import type { AppEnv } from '../env.ts'
import { claimEvidence, claimRows, existingAddressPass, renewEvidence } from '../requirements/claim.ts'
import { issueBearer, IssueConfigError } from './issue-bearer.ts'
import { issueContext } from './issue-context.ts'
import { issueOffchainPass, offchainDomain } from './issue-offchain.ts'
import type { OffchainIssueParams, PassClaimant } from './issue-offchain.ts'
import { OrphanedRightError } from './orphaned-right-error.ts'

const MEMBER_NUMBER_DRAWS = 3

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

// Attesting waits for a receipt and only then writes the member row, so counting
// rows would let concurrent claims pass a cap. A single conditional UPDATE takes
// the place before the signer spends anything.
const reservePlace = async (db: Db, cardId: string): Promise<boolean> =>
  (await db
    .update(cards)
    .set({ reserved: sql`${cards.reserved} + 1` })
    .where(and(eq(cards.id, cardId), or(isNull(cards.capacity), lt(cards.reserved, cards.capacity))))
    .returning({ id: cards.id })
    .get()) !== undefined

const releasePlace = async (db: Db, cardId: string): Promise<void> => {
  await db
    .update(cards)
    .set({ reserved: sql`${cards.reserved} - 1` })
    .where(eq(cards.id, cardId))
}

export type CardIssueError = 'card_sold_out' | 'chain_error' | 'holder_must_claim' | 'internal' | 'no_signer'

export type CardIssueOutcome =
  | { ok: true; pass: SelfServeIssueResponse }
  | { ok: false; error: CardIssueError }
  | { ok: false; error: 'requirement_unmet'; requirement: RequirementUnmet }

const passBody = (card: typeof cards.$inferSelect, memberNumber: string, now: number) => {
  const window = entitlementWindow(card, now)
  const body: IssueRequest & { memberId: string } = {
    memberId: memberNumber,
    metaURI: '',
    tier: 0,
    usageModel: card.category === 'ticket' ? USAGE_MODEL.SINGLE_USE : USAGE_MODEL.MULTI_USE,
    validFrom: window.validFrom,
    validUntil: window.validUntil,
  }
  return body
}

// A signature and two D1 rows, with no transaction
// (docs/specs/attestation-model.md#offchain-rights). The member number is drawn in
// D1 as for an on-chain pass, and is also signed into the attestation.
const issueOffchain = async (
  c: Context<AppEnv>,
  card: typeof cards.$inferSelect,
  issuer: Pick<typeof issuers.$inferSelect, 'handle' | 'id'>,
  source: string | null,
  claimant: PassClaimant | null,
  extraRows?: OffchainIssueParams['extraRows'],
): Promise<CardIssueOutcome> => {
  const chain = c.get('chain')
  if (chain.offchainAttester() === null) {
    return { error: 'no_signer', ok: false }
  }
  const domain = offchainDomain(c.env, chain)
  if (domain === null) {
    return { error: 'chain_error', ok: false }
  }
  const db = c.get('db')
  const now = c.get('now')()
  const memberNumber = await freshMemberNumber(db, issuer.id)
  if (memberNumber === null) {
    return { error: 'internal', ok: false }
  }
  if (!(await reservePlace(db, card.id))) {
    return { error: 'card_sold_out', ok: false }
  }
  try {
    const pass = await issueOffchainPass({
      baseUrl: c.env.API_BASE_URL,
      body: passBody(card, memberNumber, now),
      cardId: card.id,
      chain,
      claimant,
      db,
      domain,
      extraRows,
      issuerHandle: issuer.handle,
      issuerId: issuer.id,
      memberNumber,
      now,
      source,
    })
    return { ok: true, pass }
  } catch (error) {
    await releasePlace(db, card.id)
    if (error instanceof NoSignerError) {
      return { error: 'no_signer', ok: false }
    }
    // oxlint-disable-next-line no-console -- nothing was issued; this is the only trace of why
    console.error('offchain issuance failed', { error })
    return { error: 'internal', ok: false }
  }
}

const issueAddress = async (
  c: Context<AppEnv>,
  card: typeof cards.$inferSelect,
  issuer: Pick<typeof issuers.$inferSelect, 'handle' | 'id'>,
  source: string | null,
  claimant: PassClaimant | null,
  agreementId?: Hex,
): Promise<CardIssueOutcome> => {
  if (claimant?.kind !== 'address') {
    return { error: 'holder_must_claim', ok: false }
  }
  try {
    const existing = await existingAddressPass(c.get('db'), card.id, claimant.address, c.env.API_BASE_URL)
    if (existing !== null) {
      const renewed = await renewEvidence(
        c.get('db'),
        c.get('chain'),
        card,
        claimant.address,
        existing.uid,
        agreementId,
      )
      return renewed.ok
        ? { ok: true, pass: existing }
        : { error: 'requirement_unmet', ok: false, requirement: renewed.requirement }
    }
    const checked = await claimEvidence(c.get('db'), c.get('chain'), card, claimant.address, agreementId)
    if (!checked.ok) {
      return { error: 'requirement_unmet', ok: false, requirement: checked.requirement }
    }
    const outcome = await issueOffchain(c, card, issuer, source, claimant, (uid) =>
      claimRows(c.get('db'), card.id, claimant.address, checked.evidence, uid),
    )
    if (outcome.ok) {
      return outcome
    }
    const winner = await existingAddressPass(c.get('db'), card.id, claimant.address, c.env.API_BASE_URL)
    return winner === null ? outcome : { ok: true, pass: winner }
  } catch (error) {
    if (error instanceof ChainError) {
      return { error: 'chain_error', ok: false }
    }
    throw error
  }
}

const issueOnchain = async (
  c: Context<AppEnv>,
  card: typeof cards.$inferSelect,
  issuer: Pick<typeof issuers.$inferSelect, 'handle' | 'id'>,
  source: string | null,
): Promise<CardIssueOutcome> => {
  if (c.get('chain').signerAddress() === null) {
    return { error: 'no_signer', ok: false }
  }
  const ctx = issueContext(c)
  if (ctx === null) {
    return { error: 'chain_error', ok: false }
  }
  const memberNumber = await freshMemberNumber(ctx.db, issuer.id)
  if (memberNumber === null) {
    return { error: 'internal', ok: false }
  }
  if (!(await reservePlace(ctx.db, card.id))) {
    return { error: 'card_sold_out', ok: false }
  }
  const body = passBody(card, memberNumber, ctx.now)
  let minted = false
  try {
    const issued = await issueBearer(ctx, body, { cardId: card.id, issuerId: issuer.id, source })
    minted = true
    // The member's own name under the venue. Best-effort by design: a name that
    // failed to mirror costs a resolution, not a card (apps/api/src/ens/mirror.ts).
    if (c.env.ENS_PARENT_NAME !== undefined) {
      await mirrorMemberName(ctx.db, {
        holder: issued.holder,
        issuerHandle: issuer.handle,
        level: 'bearer',
        memberNumber,
        now: ctx.now,
        parentName: c.env.ENS_PARENT_NAME,
        rightUid: issued.uid,
      })
    }
    return { ok: true, pass: { ...issued, level: 'bearer', memberNumber } }
  } catch (error) {
    // A right that exists or may still land keeps its place for reconciliation.
    if (error instanceof UnknownTransactionOutcomeError) {
      // oxlint-disable-next-line no-console -- the tx hash is the only handle on a possible right with no member row
      console.error('attest outcome unknown', { cardId: card.id, txHash: error.txHash })
    } else if (!minted && !(error instanceof OrphanedRightError)) {
      await releasePlace(ctx.db, card.id)
    }
    if (error instanceof NoSignerError) {
      return { error: 'no_signer', ok: false }
    }
    if (error instanceof ChainError || error instanceof IssueConfigError) {
      return { error: 'chain_error', ok: false }
    }
    throw error
  }
}

// One pass under a card (docs/specs/pass-types-and-flows.md#standard-issuance).
// The card fixes tier, usage model and validity. Its caller decides who may ask, except on
// a card bound to a key, whose pass can only be issued to the key that claimed it.
export const issueForCard = async (
  c: Context<AppEnv>,
  card: typeof cards.$inferSelect,
  issuer: Pick<typeof issuers.$inferSelect, 'handle' | 'id'>,
  source: string | null,
  claimant: PassClaimant | null = null,
  agreementId?: Hex,
): Promise<CardIssueOutcome> => {
  if (card.identity !== 'none' && claimant === null) {
    return { error: 'holder_must_claim', ok: false }
  }
  if (card.identity === 'address') {
    return await issueAddress(c, card, issuer, source, claimant, agreementId)
  }
  if (card.record === 'offchain') {
    return await issueOffchain(c, card, issuer, source, claimant)
  }
  return await issueOnchain(c, card, issuer, source)
}
