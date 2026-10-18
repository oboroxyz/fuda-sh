import { eq } from 'drizzle-orm'
import { getAddress, isAddress, isHex } from 'viem'
import type { Address, Hex } from 'viem'

import type { Db } from '../db/client.ts'
import { issuers } from '../db/schema.ts'
import { issuerEnsName, memberEnsName, parseFudaEnsName } from './names.ts'
import { ensNames } from './schema.ts'

export type EnsLookupResult =
  | { address: Address; expiresAt: number | null; type: 'address' }
  | { ensNameId: number; expiresAt: number | null; stealthMetaAddress: Hex; type: 'stealth' }

interface LookupInput {
  name: string
  now: number
  parentName: string
}

type ParsedName = NonNullable<ReturnType<typeof parseFudaEnsName>>

// A venue that has never put its name on chain still has one: the resolver
// sends every never-claimed name to the gateway, and the answer is the wallet
// a claim would make the owner. That wallet is the registered operator's, so
// it is read from `issuers` rather than mirrored at registration, where a later
// claim voucher would overwrite the row and take the name dark.
const unclaimedIssuer = async (db: Db, handle: string): Promise<EnsLookupResult | null> => {
  const issuer = await db
    .select({ operatorAddress: issuers.operatorAddress })
    .from(issuers)
    .where(eq(issuers.handle, handle))
    .get()
  return issuer === undefined || !isAddress(issuer.operatorAddress, { strict: false })
    ? null
    : { address: getAddress(issuer.operatorAddress), expiresAt: null, type: 'address' }
}

// Statuses that mean nothing reached the chain: the name is still never-claimed.
const PENDING_CLAIM: ReadonlySet<string> = new Set(['voucher_issued', 'failed'])

const canonicalName = (parsed: ParsedName, parentName: string): string =>
  parsed.kind === 'issuer'
    ? issuerEnsName(parsed.issuerHandle, parentName)
    : memberEnsName(parsed.memberNumber, parsed.issuerHandle, parentName)

export const lookupEnsName = async (db: Db, input: LookupInput): Promise<EnsLookupResult | null> => {
  const parsed = parseFudaEnsName(input.name, input.parentName)
  if (parsed === null) {
    return null
  }
  const name = canonicalName(parsed, input.parentName)

  const [row] = await db.select().from(ensNames).where(eq(ensNames.name, name)).limit(1)
  // A claimed name, even one that has since lapsed, never falls back here:
  // once claimed, the namespace answers from the chain or not at all
  // (docs/specs/ens-naming.md#append-only-claim-marker).
  if (parsed.kind === 'issuer' && (row === undefined || PENDING_CLAIM.has(row.status))) {
    return await unclaimedIssuer(db, parsed.issuerHandle)
  }
  if (
    row === undefined ||
    (row.status !== 'offchain' && row.status !== 'claimed') ||
    (row.expiry !== null && input.now > row.expiry)
  ) {
    return null
  }

  if (row.level === 'private') {
    return row.stealthMetaAddress !== null &&
      row.stealthMetaAddress.length === 134 &&
      isHex(row.stealthMetaAddress)
      ? {
          ensNameId: row.id,
          expiresAt: row.expiry,
          stealthMetaAddress: row.stealthMetaAddress,
          type: 'stealth',
        }
      : null
  }

  return row.targetAddress !== null && isAddress(row.targetAddress, { strict: true })
    ? { address: row.targetAddress, expiresAt: row.expiry, type: 'address' }
    : null
}
