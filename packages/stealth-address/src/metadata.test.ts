import { describe, expect, it } from 'vitest'

import { buildAnnouncementMetadata, parseAnnouncementMetadata } from './metadata.ts'

const UID = `0x${'ab'.repeat(32)}` as const

describe(buildAnnouncementMetadata, () => {
  it('is 0x + tag(2 hex) + uid(64 hex)', () => {
    expect(buildAnnouncementMetadata(0x1f, UID)).toBe(`0x1f${'ab'.repeat(32)}`)
    expect(buildAnnouncementMetadata(5, UID)).toBe(`0x05${'ab'.repeat(32)}`)
  })
})

describe(parseAnnouncementMetadata, () => {
  it('round-trips and rejects anything else', () => {
    expect(parseAnnouncementMetadata(buildAnnouncementMetadata(0xff, UID))).toStrictEqual({
      uid: UID,
      viewTag: 255,
    })
    expect(parseAnnouncementMetadata(`0x1F${'AB'.repeat(32)}`)).toStrictEqual({ uid: UID, viewTag: 31 })
    expect(parseAnnouncementMetadata('0xdead')).toBeNull()
    // One byte too long: tag(1) + uid(32) is exactly 33 bytes, so 34 must not parse.
    expect(parseAnnouncementMetadata(`0x${'ab'.repeat(34)}`)).toBeNull()
    expect(parseAnnouncementMetadata(`0x${'zz'.repeat(33)}`)).toBeNull()
  })
})
