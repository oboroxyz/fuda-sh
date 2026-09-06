import { and, eq, inArray } from 'drizzle-orm'
import { isAddress, isHex } from 'viem'
import type { Address, Hex } from 'viem'

import type { Db } from '../db/client.ts'
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

const canonicalName = (input: LookupInput): string | null => {
  const parsed = parseFudaEnsName(input.name, input.parentName)
  if (parsed === null) {
    return null
  }
  return parsed.kind === 'issuer'
    ? issuerEnsName(parsed.issuerHandle, input.parentName)
    : memberEnsName(parsed.memberNumber, parsed.issuerHandle, input.parentName)
}

export const lookupEnsName = async (db: Db, input: LookupInput): Promise<EnsLookupResult | null> => {
  const name = canonicalName(input)
  if (name === null) {
    return null
  }

  const rows = await db
    .select()
    .from(ensNames)
    .where(and(eq(ensNames.name, name), inArray(ensNames.status, ['offchain', 'claimed'])))
    .limit(1)
  const [row] = rows
  if (row === undefined || (row.expiry !== null && input.now > row.expiry)) {
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
