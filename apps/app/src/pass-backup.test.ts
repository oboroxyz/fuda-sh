import { describe, expect, it } from 'vitest'

import { uidFromBackupFile } from './pass-backup.ts'

const UID = `0x${'ab'.repeat(32)}`

describe(uidFromBackupFile, () => {
  it('reads the uid from a backup', () => {
    expect(uidFromBackupFile(JSON.stringify({ uid: UID, version: 1 }))).toBe(UID)
  })

  it('normalizes the spelling of the uid', () => {
    expect(uidFromBackupFile(JSON.stringify({ uid: UID.toUpperCase().replace('0X', '0x') }))).toBe(UID)
  })

  it.each(['not json', '{}', '{"uid":"nope"}', 'null'])('refuses %s', (text) => {
    expect(uidFromBackupFile(text)).toBeNull()
  })
})
