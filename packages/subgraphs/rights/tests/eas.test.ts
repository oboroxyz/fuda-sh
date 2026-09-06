import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import {
  assert,
  beforeEach,
  clearStore,
  createMockedFunction,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as/assembly/index'

import { Attested, Revoked } from '../generated/EAS/EAS'
import { Right } from '../generated/schema'
import { attendanceVersion, entitlementVersion, issuerDelegationVersion, handleAttested, handleRevoked } from '../src/eas'
import { ATTENDANCE_SCHEMA_VERSIONS, ENTITLEMENT_SCHEMA_VERSIONS, ISSUER_DELEGATION_SCHEMA_VERSIONS } from '../src/schema-uids'
import { ATTENDANCE_V1_PAYLOAD, DELEGATION_V1_PAYLOAD, ENTITLEMENT_V1_PAYLOAD } from './fixtures/eas-payloads'

const EAS_ADDRESS = Address.fromString('0x4200000000000000000000000000000000000021')
const HOLDER = Address.fromString('0x1111111111111111111111111111111111111111')
const ISSUER = Address.fromString('0x2222222222222222222222222222222222222222')
const ROOT = Address.fromString('0x3333333333333333333333333333333333333333')
const OTHER = Address.fromString('0x4444444444444444444444444444444444444444')
const RIGHT_UID = Bytes.fromHexString(`0x${'aa'.repeat(32)}`)
const DELEGATION_UID = Bytes.fromHexString(`0x${'bb'.repeat(32)}`)
const ATTENDANCE_UID = Bytes.fromHexString(`0x${'cc'.repeat(32)}`)
const UNKNOWN_UID = Bytes.fromHexString(`0x${'dd'.repeat(32)}`)
const ZERO_UID = Bytes.fromHexString(`0x${'00'.repeat(32)}`)
const ENTITLEMENT_SCHEMA = Bytes.fromHexString(
  '0x42ffdba952267e373cb33ecf9fdc190fb27b30140d0695dabb8383bbed86d616',
)
const DELEGATION_SCHEMA = Bytes.fromHexString(
  '0x62c93e6e95f3956ba5937fc8454203ba781af5e455657952e915e71c3895f327',
)
const ATTENDANCE_SCHEMA = Bytes.fromHexString(
  '0x22a41470aabe3a0edec1f9948975a887f21adddd6cf009e865e267cac6e10241',
)
const UNKNOWN_SCHEMA = Bytes.fromHexString(`0x${'ee'.repeat(32)}`)

const attested = (
  uid: Bytes,
  schema: Bytes,
  recipient: Address = HOLDER,
  attester: Address = ISSUER,
): Attested => {
  const event = changetype<Attested>(newMockEvent())
  event.address = EAS_ADDRESS
  event.parameters = [
    new ethereum.EventParam('recipient', ethereum.Value.fromAddress(recipient)),
    new ethereum.EventParam('attester', ethereum.Value.fromAddress(attester)),
    new ethereum.EventParam('uid', ethereum.Value.fromFixedBytes(uid)),
    new ethereum.EventParam('schemaUID', ethereum.Value.fromFixedBytes(schema)),
  ]
  return event
}

const revoked = (uid: Bytes, schema: Bytes): Revoked => {
  const event = changetype<Revoked>(newMockEvent())
  event.address = EAS_ADDRESS
  event.parameters = [
    new ethereum.EventParam('recipient', ethereum.Value.fromAddress(HOLDER)),
    new ethereum.EventParam('attester', ethereum.Value.fromAddress(ISSUER)),
    new ethereum.EventParam('uid', ethereum.Value.fromFixedBytes(uid)),
    new ethereum.EventParam('schemaUID', ethereum.Value.fromFixedBytes(schema)),
  ]
  return event
}

const entitlementData = (): Bytes => Bytes.fromHexString(ENTITLEMENT_V1_PAYLOAD)
const delegationData = (): Bytes => Bytes.fromHexString(DELEGATION_V1_PAYLOAD)
const attendanceData = (): Bytes => Bytes.fromHexString(ATTENDANCE_V1_PAYLOAD)

const mockAttestation = (
  uid: Bytes,
  schema: Bytes,
  recipient: Address,
  attester: Address,
  refUID: Bytes,
  data: Bytes,
): void => {
  const tuple = changetype<ethereum.Tuple>([
    ethereum.Value.fromFixedBytes(uid),
    ethereum.Value.fromFixedBytes(schema),
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
    ethereum.Value.fromUnsignedBigInt(BigInt.zero()),
    ethereum.Value.fromUnsignedBigInt(BigInt.zero()),
    ethereum.Value.fromFixedBytes(refUID),
    ethereum.Value.fromAddress(recipient),
    ethereum.Value.fromAddress(attester),
    ethereum.Value.fromBoolean(true),
    ethereum.Value.fromBytes(data),
  ])
  createMockedFunction(
    EAS_ADDRESS,
    'getAttestation',
    'getAttestation(bytes32):((bytes32,bytes32,uint64,uint64,uint64,bytes32,address,address,bool,bytes))',
  )
    .withArgs([ethereum.Value.fromFixedBytes(uid)])
    .returns([ethereum.Value.fromTuple(tuple)])
}

beforeEach(() => {
  clearStore()
})

describe('EAS handlers', () => {
  test('indexes an accepted Entitlement and links its delegation', () => {
    mockAttestation(DELEGATION_UID, DELEGATION_SCHEMA, ISSUER, ROOT, ZERO_UID, delegationData())
    handleAttested(attested(DELEGATION_UID, DELEGATION_SCHEMA, ISSUER, ROOT))
    mockAttestation(RIGHT_UID, ENTITLEMENT_SCHEMA, HOLDER, ISSUER, DELEGATION_UID, entitlementData())
    handleAttested(attested(RIGHT_UID, ENTITLEMENT_SCHEMA))

    assert.entityCount('Right', 1)
    assert.fieldEquals('Right', RIGHT_UID.toHexString(), 'schemaVersion', '1')
    assert.fieldEquals('Right', RIGHT_UID.toHexString(), 'holder', HOLDER.toHexString())
    assert.fieldEquals('Right', RIGHT_UID.toHexString(), 'delegation', DELEGATION_UID.toHexString())
    assert.fieldEquals('Right', RIGHT_UID.toHexString(), 'metaURI', 'ipfs://right')
  })

  test('keeps the raw zero reference and leaves the delegation relation unresolved', () => {
    mockAttestation(RIGHT_UID, ENTITLEMENT_SCHEMA, HOLDER, ISSUER, ZERO_UID, entitlementData())
    handleAttested(attested(RIGHT_UID, ENTITLEMENT_SCHEMA))

    assert.entityCount('Right', 1)
    assert.assertTrue(Right.load(RIGHT_UID)!.delegation === null)
    assert.fieldEquals('Right', RIGHT_UID.toHexString(), 'refUID', ZERO_UID.toHexString())
  })

  test('keeps a right whose refUID belongs to an unaccepted schema', () => {
    mockAttestation(DELEGATION_UID, UNKNOWN_SCHEMA, ISSUER, ROOT, ZERO_UID, delegationData())
    handleAttested(attested(DELEGATION_UID, UNKNOWN_SCHEMA, ISSUER, ROOT))
    mockAttestation(RIGHT_UID, ENTITLEMENT_SCHEMA, HOLDER, ISSUER, DELEGATION_UID, entitlementData())
    handleAttested(attested(RIGHT_UID, ENTITLEMENT_SCHEMA))

    assert.entityCount('Right', 1)
    assert.entityCount('Delegation', 0)
    assert.assertTrue(Right.load(RIGHT_UID)!.delegation === null)
    assert.fieldEquals('Right', RIGHT_UID.toHexString(), 'refUID', DELEGATION_UID.toHexString())
  })

  test('keeps a missing delegation reference unresolved', () => {
    mockAttestation(RIGHT_UID, ENTITLEMENT_SCHEMA, HOLDER, ISSUER, DELEGATION_UID, entitlementData())
    handleAttested(attested(RIGHT_UID, ENTITLEMENT_SCHEMA))

    assert.assertTrue(Right.load(RIGHT_UID)!.delegation === null)
    assert.fieldEquals('Right', RIGHT_UID.toHexString(), 'refUID', DELEGATION_UID.toHexString())
  })

  test('preserves configured versions but never guesses the codec for a future wire format', () => {
    const entitlementV2 = Bytes.fromHexString(`0x${'f1'.repeat(32)}`)
    const delegationV2 = Bytes.fromHexString(`0x${'f2'.repeat(32)}`)
    const attendanceV2 = Bytes.fromHexString(`0x${'f3'.repeat(32)}`)
    ENTITLEMENT_SCHEMA_VERSIONS.set(entitlementV2.toHexString(), BigInt.fromI32(2))
    ISSUER_DELEGATION_SCHEMA_VERSIONS.set(delegationV2.toHexString(), BigInt.fromI32(2))
    ATTENDANCE_SCHEMA_VERSIONS.set(attendanceV2.toHexString(), BigInt.fromI32(2))
    assert.i32Equals(entitlementVersion(ENTITLEMENT_SCHEMA), 1)
    assert.i32Equals(entitlementVersion(entitlementV2), 2)
    assert.i32Equals(issuerDelegationVersion(delegationV2), 2)
    assert.i32Equals(attendanceVersion(attendanceV2), 2)

    mockAttestation(RIGHT_UID, entitlementV2, HOLDER, ISSUER, DELEGATION_UID, entitlementData())
    handleAttested(attested(RIGHT_UID, entitlementV2))
    mockAttestation(DELEGATION_UID, delegationV2, ISSUER, ROOT, ZERO_UID, delegationData())
    handleAttested(attested(DELEGATION_UID, delegationV2, ISSUER, ROOT))
    mockAttestation(ATTENDANCE_UID, attendanceV2, HOLDER, ISSUER, RIGHT_UID, attendanceData())
    handleAttested(attested(ATTENDANCE_UID, attendanceV2))
    assert.entityCount('Right', 0)
    assert.entityCount('Delegation', 0)
    assert.entityCount('Attendance', 0)
  })

  test('indexes accepted Delegation and Attendance records with their relations', () => {
    mockAttestation(DELEGATION_UID, DELEGATION_SCHEMA, ISSUER, ROOT, ZERO_UID, delegationData())
    handleAttested(attested(DELEGATION_UID, DELEGATION_SCHEMA, ISSUER, ROOT))
    mockAttestation(ATTENDANCE_UID, ATTENDANCE_SCHEMA, HOLDER, ISSUER, RIGHT_UID, attendanceData())
    handleAttested(attested(ATTENDANCE_UID, ATTENDANCE_SCHEMA))

    assert.fieldEquals('Delegation', DELEGATION_UID.toHexString(), 'issuer', ISSUER.toHexString())
    assert.fieldEquals('Delegation', DELEGATION_UID.toHexString(), 'active', 'true')
    assert.fieldEquals('Attendance', ATTENDANCE_UID.toHexString(), 'right', RIGHT_UID.toHexString())
    assert.fieldEquals('Attendance', ATTENDANCE_UID.toHexString(), 'slotId', ZERO_UID.toHexString())
  })

  test('ignores unknown schemas without calling EAS', () => {
    handleAttested(attested(UNKNOWN_UID, UNKNOWN_SCHEMA))
    assert.entityCount('Right', 0)
    assert.entityCount('Delegation', 0)
    assert.entityCount('Attendance', 0)
  })

  test('ignores a reverted getAttestation call', () => {
    createMockedFunction(
      EAS_ADDRESS,
      'getAttestation',
      'getAttestation(bytes32):((bytes32,bytes32,uint64,uint64,uint64,bytes32,address,address,bool,bytes))',
    )
      .withArgs([ethereum.Value.fromFixedBytes(RIGHT_UID)])
      .reverts()

    handleAttested(attested(RIGHT_UID, ENTITLEMENT_SCHEMA))
    assert.entityCount('Right', 0)
  })

  test('ignores malformed holder data and recipient mismatches', () => {
    mockAttestation(RIGHT_UID, ENTITLEMENT_SCHEMA, OTHER, ISSUER, DELEGATION_UID, entitlementData())
    handleAttested(attested(RIGHT_UID, ENTITLEMENT_SCHEMA, OTHER))
    assert.entityCount('Right', 0)

    mockAttestation(UNKNOWN_UID, ENTITLEMENT_SCHEMA, HOLDER, ISSUER, DELEGATION_UID, Bytes.fromHexString('0x01'))
    handleAttested(attested(UNKNOWN_UID, ENTITLEMENT_SCHEMA))
    assert.entityCount('Right', 0)
  })

  test('marks known Rights and Delegations revoked and ignores unknown entities', () => {
    mockAttestation(RIGHT_UID, ENTITLEMENT_SCHEMA, HOLDER, ISSUER, DELEGATION_UID, entitlementData())
    handleAttested(attested(RIGHT_UID, ENTITLEMENT_SCHEMA))
    mockAttestation(DELEGATION_UID, DELEGATION_SCHEMA, ISSUER, ROOT, ZERO_UID, delegationData())
    handleAttested(attested(DELEGATION_UID, DELEGATION_SCHEMA, ISSUER, ROOT))

    handleRevoked(revoked(RIGHT_UID, ENTITLEMENT_SCHEMA))
    handleRevoked(revoked(DELEGATION_UID, DELEGATION_SCHEMA))
    handleRevoked(revoked(UNKNOWN_UID, ENTITLEMENT_SCHEMA))

    assert.fieldEquals('Right', RIGHT_UID.toHexString(), 'revokedAt', '1')
    assert.fieldEquals('Delegation', DELEGATION_UID.toHexString(), 'revokedAt', '1')
    assert.entityCount('Right', 1)
    assert.entityCount('Delegation', 1)
  })
})
