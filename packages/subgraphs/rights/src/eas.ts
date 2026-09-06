import { BigInt, Bytes, TypedMap } from '@graphprotocol/graph-ts'

import { Attested, EAS, Revoked } from '../generated/EAS/EAS'
import { Attendance, Delegation, Right } from '../generated/schema'
import {
  ATTENDANCE_SCHEMA_VERSIONS,
  ENTITLEMENT_SCHEMA_VERSIONS,
  ISSUER_DELEGATION_SCHEMA_VERSIONS,
} from './schema-uids'
import { decodeAttendanceV1, decodeDelegationV1, decodeEntitlementV1 } from './codecs'

const versionOf = (versions: TypedMap<string, BigInt>, uid: Bytes): i32 => {
  const version = versions.get(uid.toHexString())
  return version === null ? 0 : version.toI32()
}

export const entitlementVersion = (uid: Bytes): i32 => versionOf(ENTITLEMENT_SCHEMA_VERSIONS, uid)
export const issuerDelegationVersion = (uid: Bytes): i32 => versionOf(ISSUER_DELEGATION_SCHEMA_VERSIONS, uid)
export const attendanceVersion = (uid: Bytes): i32 => versionOf(ATTENDANCE_SCHEMA_VERSIONS, uid)

export function handleAttested(event: Attested): void {
  const entitlement = entitlementVersion(event.params.schemaUID)
  const delegation = issuerDelegationVersion(event.params.schemaUID)
  const attendance = attendanceVersion(event.params.schemaUID)
  if (entitlement === 0 && delegation === 0 && attendance === 0) return

  const result = EAS.bind(event.address).try_getAttestation(event.params.uid)
  if (result.reverted) return
  const raw = result.value
  if (
    !raw.uid.equals(event.params.uid) ||
    !raw.schema.equals(event.params.schemaUID) ||
    !raw.recipient.equals(event.params.recipient) ||
    !raw.attester.equals(event.params.attester)
  ) {
    return
  }

  if (entitlement === 1) {
    const decoded = decodeEntitlementV1(raw.data)
    if (decoded === null || !decoded.holder.equals(raw.recipient) || !decoded.issuer.equals(raw.attester)) return
    const right = new Right(raw.uid)
    right.schemaUID = raw.schema
    right.schemaVersion = entitlement
    right.attester = raw.attester
    right.recipient = raw.recipient
    right.holder = decoded.holder
    right.issuer = decoded.issuer
    right.usageModel = decoded.usageModel
    right.tier = decoded.tier
    right.level = decoded.level
    right.serial = decoded.serial
    right.validFrom = decoded.validFrom
    right.validUntil = decoded.validUntil
    right.metaURI = decoded.metaURI
    right.delegation = raw.refUID
    right.revokedAt = null
    right.blockNumber = event.block.number
    right.timestamp = event.block.timestamp
    right.transactionHash = event.transaction.hash
    right.save()
    return
  }

  if (delegation === 1) {
    const decoded = decodeDelegationV1(raw.data)
    if (decoded === null || !decoded.issuer.equals(raw.recipient)) return
    const entity = new Delegation(raw.uid)
    entity.schemaUID = raw.schema
    entity.schemaVersion = delegation
    entity.attester = raw.attester
    entity.recipient = raw.recipient
    entity.issuer = decoded.issuer
    entity.active = decoded.active
    entity.name = decoded.name
    entity.revokedAt = null
    entity.blockNumber = event.block.number
    entity.timestamp = event.block.timestamp
    entity.transactionHash = event.transaction.hash
    entity.save()
    return
  }

  if (attendance === 1) {
    const decoded = decodeAttendanceV1(raw.data)
    if (
      decoded === null ||
      !decoded.holder.equals(raw.recipient) ||
      !decoded.rightUID.equals(raw.refUID)
    ) {
      return
    }
    const entity = new Attendance(raw.uid)
    entity.schemaUID = raw.schema
    entity.schemaVersion = attendance
    entity.attester = raw.attester
    entity.recipient = raw.recipient
    entity.right = decoded.rightUID
    entity.rightUID = decoded.rightUID
    entity.holder = decoded.holder
    entity.enteredAt = decoded.enteredAt
    entity.slotId = decoded.slotId
    entity.blockNumber = event.block.number
    entity.timestamp = event.block.timestamp
    entity.transactionHash = event.transaction.hash
    entity.save()
  }
}

export function handleRevoked(event: Revoked): void {
  if (entitlementVersion(event.params.schemaUID) > 0) {
    const right = Right.load(event.params.uid)
    if (right !== null) {
      right.revokedAt = event.block.timestamp
      right.save()
    }
    return
  }

  if (issuerDelegationVersion(event.params.schemaUID) > 0) {
    const delegation = Delegation.load(event.params.uid)
    if (delegation !== null) {
      delegation.revokedAt = event.block.timestamp
      delegation.save()
    }
  }
}
