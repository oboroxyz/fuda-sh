import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { assert, beforeEach, clearStore, describe, newMockEvent, test } from 'matchstick-as/assembly/index'

import { Announcement } from '../generated/Announcer/Announcer'
import { handleAnnouncement } from '../src/announcer'

const STEALTH_ADDRESS = Address.fromString('0x1111111111111111111111111111111111111111')
const CALLER = Address.fromString('0x2222222222222222222222222222222222222222')
const TRANSACTION_HASH = Bytes.fromHexString(`0x${'aa'.repeat(32)}`)

const announcement = (schemeId: i32, logIndex: i32, metadata: Bytes): Announcement => {
  const event = changetype<Announcement>(newMockEvent())
  event.parameters = [
    new ethereum.EventParam(
      'schemeId',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(schemeId)),
    ),
    new ethereum.EventParam('stealthAddress', ethereum.Value.fromAddress(STEALTH_ADDRESS)),
    new ethereum.EventParam('caller', ethereum.Value.fromAddress(CALLER)),
    new ethereum.EventParam(
      'ephemeralPubKey',
      ethereum.Value.fromBytes(Bytes.fromHexString('0x020304')),
    ),
    new ethereum.EventParam('metadata', ethereum.Value.fromBytes(metadata)),
  ]
  event.transaction.hash = TRANSACTION_HASH
  event.logIndex = BigInt.fromI32(logIndex)
  event.block.number = BigInt.fromI32(123)
  event.block.timestamp = BigInt.fromI32(456)
  return event
}

beforeEach(() => {
  clearStore()
})

describe('Announcement handler', () => {
  test('preserves every raw field for known and unknown schemes', () => {
    handleAnnouncement(announcement(1, 7, Bytes.fromHexString('0xdeadbeef')))
    handleAnnouncement(announcement(999, 8, Bytes.fromHexString('0x00ff')))

    const knownId = TRANSACTION_HASH.concatI32(7).toHexString()
    const unknownId = TRANSACTION_HASH.concatI32(8).toHexString()
    assert.entityCount('Announcement', 2)
    assert.fieldEquals('Announcement', knownId, 'schemeId', '1')
    assert.fieldEquals('Announcement', knownId, 'stealthAddress', STEALTH_ADDRESS.toHexString())
    assert.fieldEquals('Announcement', knownId, 'caller', CALLER.toHexString())
    assert.fieldEquals('Announcement', knownId, 'ephemeralPubKey', '0x020304')
    assert.fieldEquals('Announcement', knownId, 'metadata', '0xdeadbeef')
    assert.fieldEquals('Announcement', knownId, 'transactionHash', TRANSACTION_HASH.toHexString())
    assert.fieldEquals('Announcement', knownId, 'logIndex', '7')
    assert.fieldEquals('Announcement', knownId, 'blockNumber', '123')
    assert.fieldEquals('Announcement', knownId, 'timestamp', '456')
    assert.fieldEquals('Announcement', unknownId, 'schemeId', '999')
    assert.fieldEquals('Announcement', unknownId, 'metadata', '0x00ff')
  })

  test('keeps multiple logs from one transaction as separate entities', () => {
    handleAnnouncement(announcement(1, 4, Bytes.fromHexString('0x01')))
    handleAnnouncement(announcement(1, 5, Bytes.fromHexString('0x02')))

    assert.entityCount('Announcement', 2)
    assert.fieldEquals(
      'Announcement',
      TRANSACTION_HASH.concatI32(4).toHexString(),
      'metadata',
      '0x01',
    )
    assert.fieldEquals(
      'Announcement',
      TRANSACTION_HASH.concatI32(5).toHexString(),
      'metadata',
      '0x02',
    )
  })
})
