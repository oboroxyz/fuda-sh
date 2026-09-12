import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

describe('issuer default Card migration', () => {
  it('preserves existing issuers and gives them no default Card', () => {
    const db = new DatabaseSync(':memory:')
    try {
      const migrations = new URL('../migrations/', import.meta.url)
      for (const filename of readdirSync(migrations)
        .filter((name) => name.endsWith('.sql') && name < '0014')
        .toSorted()) {
        db.exec(readFileSync(new URL(filename, migrations), 'utf-8'))
      }
      db.exec(`
        INSERT INTO issuers (id, handle, name, brand_color, operator_address, created_at)
        VALUES ('venue', 'coffee', 'Coffee', '#112233', 'operator', 1);
      `)

      db.exec(readFileSync(new URL('0014_issuer_default_card.sql', migrations), 'utf-8'))

      expect(db.prepare('SELECT id, default_card_slug FROM issuers').get()).toMatchObject({
        default_card_slug: null,
        id: 'venue',
      })
      db.exec("UPDATE issuers SET default_card_slug = 'stamp' WHERE id = 'venue'")
      expect(db.prepare('SELECT default_card_slug FROM issuers WHERE id = ?').get('venue')).toMatchObject({
        default_card_slug: 'stamp',
      })
    } finally {
      db.close()
    }
  })
})
