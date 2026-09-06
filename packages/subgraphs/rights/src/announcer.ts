import { Announcement as AnnouncementEvent } from '../generated/Announcer/Announcer'
import { Announcement } from '../generated/schema'

export function handleAnnouncement(event: AnnouncementEvent): void {
  const entity = new Announcement(event.transaction.hash.concatI32(event.logIndex.toI32()))
  entity.schemeId = event.params.schemeId
  entity.stealthAddress = event.params.stealthAddress
  entity.caller = event.params.caller
  entity.ephemeralPubKey = event.params.ephemeralPubKey
  entity.metadata = event.params.metadata
  entity.transactionHash = event.transaction.hash
  entity.logIndex = event.logIndex
  entity.blockNumber = event.block.number
  entity.timestamp = event.block.timestamp
  entity.save()
}
