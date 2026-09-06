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
import { handleAttested, handleRevoked } from '../src/eas'

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

const entitlementData = (holder: Address = HOLDER): Bytes =>
  ethereum.encode(
    ethereum.Value.fromTuple(
      changetype<ethereum.Tuple>([
        ethereum.Value.fromAddress(holder),
        ethereum.Value.fromAddress(ISSUER),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(2)),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)),
        ethereum.Value.fromFixedBytes(ZERO_UID),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(10)),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(20)),
        ethereum.Value.fromString('ipfs://right'),
      ]),
    ),
  )!

const delegationData = (): Bytes =>
  ethereum.encode(
    ethereum.Value.fromTuple(
      changetype<ethereum.Tuple>([
        ethereum.Value.fromAddress(ISSUER),
        ethereum.Value.fromBoolean(true),
        ethereum.Value.fromString('issuer'),
      ]),
    ),
  )!

const attendanceData = (): Bytes =>
  ethereum.encode(
    ethereum.Value.fromTuple(
      changetype<ethereum.Tuple>([
        ethereum.Value.fromFixedBytes(RIGHT_UID),
        ethereum.Value.fromAddress(HOLDER),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(15)),
        ethereum.Value.fromFixedBytes(ZERO_UID),
      ]),
    ),
  )!

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
    mockAttestation(RIGHT_UID, ENTITLEMENT_SCHEMA, HOLDER, ISSUER, DELEGATION_UID, entitlementData())
    handleAttested(attested(RIGHT_UID, ENTITLEMENT_SCHEMA))

    assert.entityCount('Right', 1)
    assert.fieldEquals('Right', RIGHT_UID.toHexString(), 'schemaVersion', '1')
    assert.fieldEquals('Right', RIGHT_UID.toHexString(), 'holder', HOLDER.toHexString())
    assert.fieldEquals('Right', RIGHT_UID.toHexString(), 'delegation', DELEGATION_UID.toHexString())
    assert.fieldEquals('Right', RIGHT_UID.toHexString(), 'metaURI', 'ipfs://right')
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
    mockAttestation(RIGHT_UID, ENTITLEMENT_SCHEMA, HOLDER, ISSUER, DELEGATION_UID, entitlementData(OTHER))
    handleAttested(attested(RIGHT_UID, ENTITLEMENT_SCHEMA))
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
