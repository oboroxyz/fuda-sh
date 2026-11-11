import { isMemberNumber } from '@fuda/sdk'
import { and, eq, inArray, lte, ne, or } from 'drizzle-orm'
import type { Hex } from 'viem'

import type { Db } from '../db/client.ts'
import { issuerEnsName, memberEnsName } from './names.ts'
import { ensNames } from './schema.ts'

// The `ens_names` mirror is what `POST /ens/gateway` answers from
// (docs/specs/ens-naming.md#hybrid-resolution), except for a venue name that has
// never been claimed, which `lookup.ts` answers from `issuers`. Nothing else
// writes the mirror, so every write in the product goes through this module.
//
// A member name is a convenience attached to a right; the right is the product.
// Those mirror writes stay best-effort, because a failed issuance would cost a
// member their card. Issuer claims are different: a claim route must not report
// success for a row that never persisted, so their writer below reports failures
// to its route.
const quietly = async <T>(what: string, write: () => Promise<T>): Promise<void> => {
  try {
    await write()
  } catch (error) {
    // oxlint-disable-next-line no-console -- a name that silently stopped being written is otherwise invisible
    console.error(`ens mirror: ${what} failed`, error)
  }
}

export interface MemberNameInput {
  holder: Hex
  issuerHandle: string
  level: 'bearer' | 'signed'
  memberNumber: string
  now: number
  parentName: string
  rightUid: Hex
}

// One name per right, written at issuance. Only a generated member number is a
// legal label: the admin path takes free text for `memberId` and that text must
// never reach the ENS namespace (docs/specs/ens-naming.md#member-number).
export const mirrorMemberName = async (db: Db, input: MemberNameInput): Promise<void> => {
  if (!isMemberNumber(input.memberNumber)) {
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
        ownerAddress: input.holder,
        rightUid: input.rightUid,
        status: 'offchain',
        targetAddress: input.holder,
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
  const name = issuerEnsName(input.handle, input.parentName)
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
  const insert = db
    .insert(ensNames)
    .values({ ...row, createdAt: input.now, voucherIssuedAt: row.voucherIssuedAt ?? input.now })
  if (input.status === 'claimed') {
    await insert.onConflictDoUpdate({ set: row, target: ensNames.name })
    return
  }
  // A voucher request can race a successful confirmation after its initial
  // status read. Protect a live claim while allowing re-registration after expiry.
  await insert.onConflictDoUpdate({
    set: { ...row, claimTxHash: ensNames.claimTxHash, expiry: ensNames.expiry },
    setWhere: or(
      ne(ensNames.status, 'claimed'),
      input.status === 'voucher_issued' ? lte(ensNames.expiry, input.now) : undefined,
    ),
    target: ensNames.name,
  })
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
