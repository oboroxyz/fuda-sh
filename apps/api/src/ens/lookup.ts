import { eq } from 'drizzle-orm'
import { getAddress, isAddress } from 'viem'
import type { Address } from 'viem'

import type { Db } from '../db/client.ts'
import { issuers } from '../db/schema.ts'
import { issuerEnsName, memberEnsName, parseFudaEnsName } from './names.ts'
import { ensNames } from './schema.ts'

export interface EnsLookupResult {
  address: Address
  expiresAt: number | null
}

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
// claim voucher would overwrite the row and take the name dark. A venue an account
// owns has no wallet, so its name resolves to nothing until one claims it.
const unclaimedIssuer = async (db: Db, handle: string): Promise<EnsLookupResult | null> => {
  const issuer = await db
    .select({ operatorAddress: issuers.operatorAddress })
    .from(issuers)
    .where(eq(issuers.handle, handle))
    .get()
  return issuer?.operatorAddress === null ||
    issuer === undefined ||
    !isAddress(issuer.operatorAddress, { strict: false })
    ? null
    : { address: getAddress(issuer.operatorAddress), expiresAt: null }
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

  return row.targetAddress !== null && isAddress(row.targetAddress, { strict: true })
    ? { address: row.targetAddress, expiresAt: row.expiry }
    : null
}
