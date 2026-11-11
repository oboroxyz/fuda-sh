import { passUrls, toQr, normalizeUid } from '@fuda/sdk'
import type { RequirementKind, RequirementUnmet, SelfServeIssueResponse } from '@fuda/sdk'
import { and, eq } from 'drizzle-orm'
import type { Hex } from 'viem'

import { walletValidity } from '../pass/wallet-status.ts'

import type { ChainClient } from '../chain/client.ts'
import { ZERO_ADDRESS } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { cardAddressPasses, members, passEvidence } from '../db/schema.ts'
import type { cards } from '../db/schema.ts'
import { presentationRequirements } from './presentation.ts'
import { requirementAdapters } from './registry.ts'
import { requirementsOf } from './store.ts'

export interface Evidence {
  kind: RequirementKind
  evidence: string
}
export type ClaimEvidence = { ok: true; evidence: Evidence[] } | { ok: false; requirement: RequirementUnmet }

export const claimEvidence = async (
  db: Db,
  chain: ChainClient,
  card: typeof cards.$inferSelect,
  holder: Hex,
  agreementId?: Hex,
): Promise<ClaimEvidence> => {
  const evidence: Evidence[] = []
  for (const requirement of await requirementsOf(db, card)) {
    // oxlint-disable-next-line no-await-in-loop -- preserve the Card's requirement order and stop on the first failure
    const checked = await requirementAdapters[requirement.kind].claimCheck(
      chain,
      requirement,
      holder,
      agreementId,
    )
    if (!checked.met) {
      return { ok: false, requirement: { detail: checked.detail, kind: requirement.kind } }
    }
    evidence.push({ evidence: checked.evidence, kind: requirement.kind })
  }
  return { evidence, ok: true }
}

export const existingAddressPass = async (
  db: Db,
  cardId: string,
  address: Hex,
  baseUrl: string,
): Promise<SelfServeIssueResponse | null> => {
  const row = await db
    .select({ memberNumber: members.memberId, uid: members.attestationUid })
    .from(cardAddressPasses)
    .innerJoin(members, eq(members.attestationUid, cardAddressPasses.attestationUid))
    .where(and(eq(cardAddressPasses.cardId, cardId), eq(cardAddressPasses.address, address.toLowerCase())))
    .get()
  const uid = row === undefined ? null : normalizeUid(row.uid)
  return row === undefined || uid === null
    ? null
    : {
        holder: ZERO_ADDRESS,
        level: 'signed',
        memberNumber: row.memberNumber,
        passUrls: passUrls(baseUrl, uid),
        qr: toQr(uid),
        uid,
      }
}

export const addressPassOver = async (db: Db, uid: Hex, now: number): Promise<boolean> => {
  const row = await db.select().from(members).where(eq(members.attestationUid, uid)).get()
  if (row === undefined) {
    return false
  }
  const { status } = await walletValidity(db, uid, row, now)
  return status === 'expired' || status === 'revoked'
}

const evidenceRows = (db: Db, evidence: Evidence[], uid: Hex) =>
  evidence.map((entry, position) =>
    db.insert(passEvidence).values({ ...entry, attestationUid: uid, position }),
  )

export const claimRows = (
  db: Db,
  cardId: string,
  address: Hex,
  evidence: Evidence[],
  uid: Hex,
  previous?: Hex,
) => [
  ...(previous === undefined
    ? []
    : [
        db
          .delete(cardAddressPasses)
          .where(
            and(
              eq(cardAddressPasses.cardId, cardId),
              eq(cardAddressPasses.address, address.toLowerCase()),
              eq(cardAddressPasses.attestationUid, previous),
            ),
          ),
      ]),
  db.insert(cardAddressPasses).values({ address: address.toLowerCase(), attestationUid: uid, cardId }),
  ...evidenceRows(db, evidence, uid),
]

// A usable pass takes new evidence when the asset owner grants another agreement.
export const renewEvidence = async (
  db: Db,
  chain: ChainClient,
  card: typeof cards.$inferSelect,
  holder: Hex,
  uid: Hex,
  agreementId?: Hex,
): Promise<{ ok: true } | { ok: false; requirement: RequirementUnmet }> => {
  const held = await presentationRequirements(db, chain, uid, holder)
  if (held.met) {
    return { ok: true }
  }
  const checked = await claimEvidence(db, chain, card, holder, agreementId)
  if (!checked.ok) {
    return checked
  }
  await db.batch([
    db.delete(passEvidence).where(eq(passEvidence.attestationUid, uid)),
    ...evidenceRows(db, checked.evidence, uid),
  ])
  return { ok: true }
}
