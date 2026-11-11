import type { RequirementUnmet } from '@fuda/sdk'
import { asc, eq } from 'drizzle-orm'
import type { Hex } from 'viem'

import type { ChainClient } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { cards, members, passEvidence } from '../db/schema.ts'
import type { Evidence } from './claim.ts'
import { requirementAdapters } from './registry.ts'
import { requirementsOf } from './store.ts'

export type PresentationRequirements =
  | { met: true; evidence: Evidence[] }
  | { met: false; requirement: RequirementUnmet }

export const presentationRequirements = async (
  db: Db,
  chain: ChainClient,
  uid: Hex,
  holder: Hex | null,
): Promise<PresentationRequirements> => {
  const card = await db
    .select({ id: cards.id, identity: cards.identity })
    .from(members)
    .innerJoin(cards, eq(cards.id, members.cardId))
    .where(eq(members.attestationUid, uid))
    .get()
  if (card === undefined || card.identity !== 'address') {
    return { evidence: [], met: true }
  }
  const requirements = await requirementsOf(db, card)
  const stored = await db
    .select()
    .from(passEvidence)
    .where(eq(passEvidence.attestationUid, uid))
    .orderBy(asc(passEvidence.position))
  const evidence: Evidence[] = []
  for (const [position, requirement] of requirements.entries()) {
    const row = stored.find((entry) => entry.position === position && entry.kind === requirement.kind)
    if (row === undefined || holder === null) {
      return { met: false, requirement: { detail: 'agreement-inactive', kind: requirement.kind } }
    }
    // oxlint-disable-next-line no-await-in-loop -- preserve requirement order and stop on the first failure
    const checked = await requirementAdapters[requirement.kind].presentationCheck(
      chain,
      requirement,
      holder,
      row.evidence,
    )
    if (!checked.met) {
      return { met: false, requirement: { detail: checked.detail, kind: requirement.kind } }
    }
    evidence.push({ evidence: row.evidence, kind: requirement.kind })
  }
  return { evidence, met: true }
}
