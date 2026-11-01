import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

const applyUpTo = (db: DatabaseSync, before: string): void => {
  const migrations = new URL('../migrations/', import.meta.url)
  for (const filename of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql') && name < before)
    .toSorted()) {
    db.exec(readFileSync(new URL(filename, migrations), 'utf-8'))
  }
}

describe('issuers per account migration', () => {
  it('keeps every issuer and the rows that reference it, and lets one address own another', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('PRAGMA foreign_keys = ON')
      applyUpTo(db, '0018')
      db.exec(`
        INSERT INTO issuers (id, handle, name, brand_color, operator_address, created_at, logo_prefix, default_card_slug)
        VALUES ('venue', 'coffee', 'Coffee', '#112233', '0xabc', 1, 'logos/1', 'stamp');
        INSERT INTO cards (id, issuer_id, title, category, created_at, slug) VALUES ('card', 'venue', 'Stamp', 'membership', 1, 'stamp');
      `)
      expect(() => {
        db.exec(`INSERT INTO issuers (id, handle, name, brand_color, operator_address, created_at)
          VALUES ('second', 'tea', 'Tea', '#112233', '0xabc', 2)`)
      }).toThrow(/UNIQUE/u)

      const migrations = new URL('../migrations/', import.meta.url)
      // D1 applies a migration file as one transaction, which is what lets the
      // deferred foreign-key check see the renamed table rather than the gap.
      db.exec(`BEGIN; ${readFileSync(new URL('0018_issuers_per_account.sql', migrations), 'utf-8')} COMMIT;`)
      for (const later of readdirSync(migrations).filter(
        (name) => name.endsWith('.sql') && name > '0018_issuers_per_account.sql',
      )) {
        db.exec(readFileSync(new URL(later, migrations), 'utf-8'))
      }

      db.exec(`INSERT INTO issuers (id, handle, name, brand_color, operator_address, created_at)
        VALUES ('second', 'tea', 'Tea', '#112233', '0xabc', 2)`)
      expect(
        db
          .prepare('SELECT id, handle, logo_prefix, default_card_slug FROM issuers ORDER BY created_at')
          .all()
          .map((row) => ({ ...row })),
      ).toStrictEqual([
        { default_card_slug: 'stamp', handle: 'coffee', id: 'venue', logo_prefix: 'logos/1' },
        { default_card_slug: null, handle: 'tea', id: 'second', logo_prefix: null },
      ])
      expect(db.prepare('PRAGMA foreign_key_check').all()).toStrictEqual([])
      expect(() => {
        db.exec(`INSERT INTO issuers (id, handle, name, brand_color, operator_address, created_at)
          VALUES ('third', 'tea', 'Tea', '#112233', '0xdef', 3)`)
      }).toThrow(/UNIQUE/u)
      expect(() => {
        db.exec(
          `INSERT INTO cards (id, issuer_id, title, category, created_at, slug) VALUES ('orphan', 'gone', 'X', 'membership', 1, 'x')`,
        )
      }).toThrow(/FOREIGN KEY/u)
    } finally {
      db.close()
    }
  })
})
