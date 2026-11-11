import { asHex } from '@fuda/sdk'
import type { RequirementUnmet } from '@fuda/sdk'
import { asc, eq } from 'drizzle-orm'
import type { Hex } from 'viem'

import type { ChainClient } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { cardAddressPasses, cards, members, passEvidence } from '../db/schema.ts'
import type { Bindings } from '../env.ts'
import { requirementsAllowed } from './allowlist.ts'
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
  env: Pick<Bindings, 'IP_REGISTRIES'>,
  knownCard?: Pick<typeof cards.$inferSelect, 'id' | 'hasRequirements'>,
): Promise<PresentationRequirements> => {
  if (knownCard?.hasRequirements === false) {
    return { evidence: [], met: true }
  }
  const card =
    knownCard ??
    (await db
      .select({ hasRequirements: cards.hasRequirements, id: cards.id })
      .from(members)
      .innerJoin(cards, eq(cards.id, members.cardId))
      .where(eq(members.attestationUid, uid))
      .get())
  if (card === undefined || !card.hasRequirements) {
    return { evidence: [], met: true }
  }
  const address = await db
    .select({ address: cardAddressPasses.address })
    .from(cardAddressPasses)
    .where(eq(cardAddressPasses.attestationUid, uid))
    .get()
  const holder = address === undefined ? null : asHex(address.address, 20)
  const requirements = await requirementsOf(db, card)
  const stored = await db
    .select()
    .from(passEvidence)
    .where(eq(passEvidence.attestationUid, uid))
    .orderBy(asc(passEvidence.position))
  const evidence: Evidence[] = []
  for (const [position, requirement] of requirements.entries()) {
    if (!requirementsAllowed(env, [requirement])) {
      return { met: false, requirement: { detail: 'registry-not-allowed', kind: requirement.kind } }
    }
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
