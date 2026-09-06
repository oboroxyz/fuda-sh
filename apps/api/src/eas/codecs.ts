import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters } from 'viem'
import type { Hex } from 'viem'

import { SCHEMA_STRINGS } from './schemas.ts'

const ENTITLEMENT_V1 = parseAbiParameters(SCHEMA_STRINGS.entitlement)
const DELEGATION_V1 = parseAbiParameters(SCHEMA_STRINGS.issuerDelegation)
const ATTENDANCE_V1 = parseAbiParameters(SCHEMA_STRINGS.attendance)

export interface EntitlementV1 {
  holder: Hex
  issuer: Hex
  usageModel: number
  tier: number
  level: number
  serial: Hex
  validFrom: bigint
  validUntil: bigint
  metaURI: string
}
// Canonical internal type. v1 → canonical is the identity plus the version tag;
// a future v2 adds a codec here and an entry in EAS_SCHEMAS, nothing else.
export type Entitlement = EntitlementV1 & { schemaVersion: number }

export const encodeEntitlementV1 = (e: EntitlementV1): Hex =>
  encodeAbiParameters(ENTITLEMENT_V1, [
    e.holder,
    e.issuer,
    e.usageModel,
    e.tier,
    e.level,
    e.serial,
    e.validFrom,
    e.validUntil,
    e.metaURI,
  ])

export const decodeEntitlementV1 = (data: Hex): EntitlementV1 => {
  const [holder, issuer, usageModel, tier, level, serial, validFrom, validUntil, metaURI] =
    decodeAbiParameters(ENTITLEMENT_V1, data)
  return { holder, issuer, level, metaURI, serial, tier, usageModel, validFrom, validUntil }
}

export const toCanonical = (v1: EntitlementV1): Entitlement => ({ ...v1, schemaVersion: 1 })

export const decodeEntitlement = (version: number, data: Hex): Entitlement => {
  if (version === 1) {
    return toCanonical(decodeEntitlementV1(data))
  }
  throw new Error(`no Entitlement codec for schema version ${version}`)
}

export interface DelegationV1 {
  issuer: Hex
  active: boolean
  name: string
}
export type Delegation = DelegationV1 & { schemaVersion: number }

export const encodeDelegationV1 = (d: DelegationV1): Hex =>
  encodeAbiParameters(DELEGATION_V1, [d.issuer, d.active, d.name])

export const decodeDelegation = (version: number, data: Hex): Delegation => {
  if (version === 1) {
    const [issuer, active, name] = decodeAbiParameters(DELEGATION_V1, data)
    return { active, issuer, name, schemaVersion: 1 }
  }
  throw new Error(`no IssuerDelegation codec for schema version ${version}`)
}

export interface Attendance {
  rightUID: Hex
  holder: Hex
  enteredAt: bigint
  slotId: Hex
}

export const encodeAttendanceV1 = (a: Attendance): Hex =>
  encodeAbiParameters(ATTENDANCE_V1, [a.rightUID, a.holder, a.enteredAt, a.slotId])

export const decodeAttendanceV1 = (data: Hex): Attendance => {
  const [rightUID, holder, enteredAt, slotId] = decodeAbiParameters(ATTENDANCE_V1, data)
  return { enteredAt, holder, rightUID, slotId }
}
