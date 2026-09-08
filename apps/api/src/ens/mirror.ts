import { isMemberNumber } from '@fuda/sdk'
import { and, eq, inArray } from 'drizzle-orm'
import type { Hex } from 'viem'

import { ZERO_ADDRESS } from '../chain/client.ts'
import type { Db } from '../db/client.ts'
import { issuerEnsName, memberEnsName } from './names.ts'
import { ensNames } from './schema.ts'

// The `ens_names` mirror is what `POST /ens/gateway` answers from
// (docs/specs/ens-naming.md#hybrid-resolution). Nothing else writes it, so every
// write in the product goes through this module.
//
// A name is a convenience attached to a right; the right is the product. So a
// mirror write never fails the operation that triggered it — a missing row costs
// a resolution, a failed issuance costs a member their card.
const quietly = async <T>(what: string, write: () => Promise<T>): Promise<void> => {
  try {
    await write()
  } catch (error) {
    // oxlint-disable-next-line no-console -- a name that silently stopped being written is otherwise invisible
    console.error(`ens mirror: ${what} failed`, error)
  }
}

export interface MemberNameInput {
  holder: Hex | null
  issuerHandle: string
  level: 'bearer' | 'signed' | 'private'
  memberNumber: string
  now: number
  parentName: string
  rightUid: Hex
  stealthMetaAddress: Hex | null
}

// One name per right, written at issuance. Only a generated member number is a
// legal label: the admin path takes free text for `memberId` and that text must
// never reach the ENS namespace (docs/specs/ens-naming.md#member-number).
//
// A private right is mirrored by meta-address rather than by holder, because its
// answer is a fresh stealth address on every query and its stable holder must
// never be stored.
export const mirrorMemberName = async (db: Db, input: MemberNameInput): Promise<void> => {
  if (!isMemberNumber(input.memberNumber)) {
    return
  }
  const isPrivate = input.level === 'private'
  if (isPrivate ? input.stealthMetaAddress === null : input.holder === null) {
    return
  }
  let name: string
  try {
    name = memberEnsName(input.memberNumber, input.issuerHandle, input.parentName)
  } catch {
    return
  }
  await quietly(
    `member name ${name}`,
    async () =>
      await db.insert(ensNames).values({
        createdAt: input.now,
        issuerHandle: input.issuerHandle,
        kind: 'member',
        level: input.level,
        name,
        // The holder owns the right. A private right has no holder fuda may record
        // — that is the point of it — so the column carries the zero address rather
        // than a stand-in that would read like a real account.
        ownerAddress: input.holder ?? ZERO_ADDRESS,
        rightUid: input.rightUid,
        status: 'offchain',
        stealthMetaAddress: isPrivate ? input.stealthMetaAddress : null,
        targetAddress: isPrivate ? null : input.holder,
        updatedAt: input.now,
      }),
  )
}

export interface IssuerNameInput {
  claimTxHash?: Hex
  expiry?: number
  handle: string
  now: number
  owner: Hex
  parentName: string
  status: 'voucher_issued' | 'claimed' | 'failed'
}

// The issuer's own name, written when a claim voucher is signed and updated when
// the claim transaction is confirmed. Unlike a member name this one is backed by
// an onchain User Registry entry, so `claimed` means the chain agrees.
export const mirrorIssuerName = async (db: Db, input: IssuerNameInput): Promise<void> => {
  let name: string
  try {
    name = issuerEnsName(input.handle, input.parentName)
  } catch {
    return
  }
  const row = {
    claimTxHash: input.claimTxHash ?? null,
    expiry: input.expiry ?? null,
    issuerHandle: input.handle,
    kind: 'issuer' as const,
    name,
    ownerAddress: input.owner,
    status: input.status,
    targetAddress: input.owner,
    updatedAt: input.now,
    voucherIssuedAt: input.status === 'voucher_issued' ? input.now : undefined,
  }
  await quietly(
    `issuer name ${name}`,
    async () =>
      await db
        .insert(ensNames)
        .values({ ...row, createdAt: input.now, voucherIssuedAt: row.voucherIssuedAt ?? input.now })
        .onConflictDoUpdate({ set: row, target: ensNames.name }),
  )
}

// Revocation is what the gate reads, and a name that still resolved after it
// would outlive the right it names. `lookup` answers only `offchain` and
// `claimed`, so this one update is what takes the name dark.
export const darkenMemberName = async (db: Db, input: { now: number; rightUid: Hex }): Promise<void> => {
  await quietly(
    `darken ${input.rightUid}`,
    async () =>
      await db
        .update(ensNames)
        .set({ status: 'unregistered', updatedAt: input.now })
        .where(
          and(
            eq(ensNames.rightUid, input.rightUid),
            eq(ensNames.kind, 'member'),
            inArray(ensNames.status, ['offchain', 'claimed']),
          ),
        ),
  )
}
