import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

describe('member issuance metadata migration', () => {
  it('leaves historical issuance state unknown and stores exact new snapshots', () => {
    const db = new DatabaseSync(':memory:')
    try {
      const migrations = new URL('../migrations/', import.meta.url)
      for (const filename of readdirSync(migrations)
        .filter((name) => name.endsWith('.sql') && name < '0013')
        .toSorted()) {
        db.exec(readFileSync(new URL(filename, migrations), 'utf-8'))
      }
      db.exec(`
        INSERT INTO members (attestation_uid, created_at, level, member_id)
        VALUES ('historic', 1, 'bearer', 'historic-member');
      `)

      db.exec(readFileSync(new URL('0013_member_issuance_metadata.sql', migrations), 'utf-8'))

      const historic = db
        .prepare('SELECT valid_from, valid_until, usage_model FROM members WHERE attestation_uid = ?')
        .get('historic')
      expect({ ...historic }).toStrictEqual({ usage_model: null, valid_from: null, valid_until: null })
      db.exec(`
        INSERT INTO members (
          attestation_uid, created_at, level, member_id, valid_from, valid_until, usage_model
        ) VALUES ('new', 2, 'bearer', 'new-member', 12, 34, 2);
      `)
      const issued = db
        .prepare('SELECT valid_from, valid_until, usage_model FROM members WHERE attestation_uid = ?')
        .get('new')
      expect({ ...issued }).toStrictEqual({ usage_model: 2, valid_from: 12, valid_until: 34 })
    } finally {
      db.close()
    }
  })
})
