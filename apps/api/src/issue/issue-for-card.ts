import { entitlementWindow, generateMemberNumber, USAGE_MODEL } from '@fuda/sdk'
import type { IssueRequest, SelfServeIssueResponse } from '@fuda/sdk'
import { and, eq, inArray } from 'drizzle-orm'
import type { Context } from 'hono'

import { ChainError, NoSignerError } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { members } from '../db/schema.ts'
import type { cards, issuers } from '../db/schema.ts'
import { mirrorMemberName } from '../ens/mirror.ts'
import type { AppEnv } from '../env.ts'
import { issueBearer, IssueConfigError } from './issue-bearer.ts'
import { issueContext } from './issue-context.ts'

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

export type CardIssueError = 'chain_error' | 'internal' | 'no_signer'

export type CardIssueOutcome =
  | { ok: true; pass: SelfServeIssueResponse }
  | { ok: false; error: CardIssueError }

// One Bearer pass under a card (docs/specs/pass-types-and-flows.md#u1-standard-issuance-and-optional-activation).
// The card fixes tier, usage model and validity. Its caller decides who may ask.
export const issueForCard = async (
  c: Context<AppEnv>,
  card: typeof cards.$inferSelect,
  issuer: Pick<typeof issuers.$inferSelect, 'handle' | 'id'>,
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
  const window = entitlementWindow(card, ctx.now)
  const body: IssueRequest & { memberId: string } = {
    memberId: memberNumber,
    metaURI: '',
    tier: 0,
    usageModel: card.category === 'ticket' ? USAGE_MODEL.SINGLE_USE : USAGE_MODEL.MULTI_USE,
    validFrom: window.validFrom,
    validUntil: window.validUntil,
  }
  try {
    const issued = await issueBearer(ctx, body, { cardId: card.id, issuerId: issuer.id })
    if (issued.level === 'private') {
      return { error: 'internal', ok: false }
    }
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
        stealthMetaAddress: null,
      })
    }
    return { ok: true, pass: { ...issued, level: 'bearer', memberNumber } }
  } catch (error) {
    if (error instanceof NoSignerError) {
      return { error: 'no_signer', ok: false }
    }
    if (error instanceof ChainError || error instanceof IssueConfigError) {
      return { error: 'chain_error', ok: false }
    }
    throw error
  }
}
