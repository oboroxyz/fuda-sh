import * as v from 'valibot'
import { encodePacked, keccak256, zeroAddress } from 'viem'
import type { Hex } from 'viem'

export const SCHEMA_STRINGS = {
  attendance: 'bytes32 rightUID,address holder,uint64 enteredAt,bytes32 slotId',
  entitlement:
    'address holder,address issuer,uint8 usageModel,uint8 tier,uint8 level,bytes32 serial,uint64 validFrom,uint64 validUntil,string metaURI',
  issuerDelegation: 'address issuer,bool active,string name',
} as const
export type SchemaKind = keyof typeof SCHEMA_STRINGS

// EAS schema UIDs are deterministic: keccak256(encodePacked(schema, resolver, revocable)).
// All fuda schemas use resolver = 0x0 and revocable = true.
export const schemaUid = (schema: string): Hex =>
  keccak256(encodePacked(['string', 'address', 'bool'], [schema, zeroAddress, true]))

export interface AcceptedVersion {
  uid: Hex
  version: number
}
export type SchemaSets = Record<SchemaKind, AcceptedVersion[]>

const Version = v.object({
  uid: v.pipe(v.string(), v.regex(/^0x[0-9a-fA-F]{64}$/u)),
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
})
const Sets = v.object({
  attendance: v.array(Version),
  entitlement: v.array(Version),
  issuerDelegation: v.array(Version),
})

const lowerUids = (list: readonly v.InferOutput<typeof Version>[]): AcceptedVersion[] =>
  list.map((e) => {
    // SAFETY: `e.uid` already matched the ^0x[0-9a-fA-F]{64}$ schema above; lowercasing preserves that shape.
    const uid = e.uid.toLowerCase() as Hex
    return { uid, version: e.version }
  })

export const parseSchemaSets = (json: string) => {
  const parsed: unknown = JSON.parse(json)
  const out = v.parse(Sets, parsed)
  return {
    attendance: lowerUids(out.attendance),
    entitlement: lowerUids(out.entitlement),
    issuerDelegation: lowerUids(out.issuerDelegation),
  } satisfies SchemaSets
}

export const findVersion = (set: AcceptedVersion[], uid: string): AcceptedVersion | null => {
  const needle = uid.toLowerCase()
  return set.find((e) => e.uid === needle) ?? null
}

export const newest = (set: AcceptedVersion[]): AcceptedVersion | null => {
  let best: AcceptedVersion | null = null
  for (const e of set) {
    if (best === null || e.version > best.version) {
      best = e
    }
  }
  return best
}
