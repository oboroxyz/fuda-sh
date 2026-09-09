import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

describe('Card description migration', () => {
  it('preserves both old texts, card identity and related rows while removing the old columns', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('PRAGMA foreign_keys = ON')
      const migrations = new URL('../migrations/', import.meta.url)
      for (const filename of readdirSync(migrations)
        .filter((name) => name.endsWith('.sql') && name < '0012')
        .toSorted()) {
        db.exec(readFileSync(new URL(filename, migrations), 'utf-8'))
      }
      db.exec(`
        INSERT INTO issuers (id, handle, name, brand_color, operator_address, created_at)
        VALUES ('venue', 'coffee', 'Coffee', '#112233', 'operator', 1);
        INSERT INTO cards (id, issuer_id, title, category, slug, perk, reward, created_at) VALUES
          ('both', 'venue', 'Both', 'membership', 'both', 'First line', 'Second line', 1),
          ('perk', 'venue', 'Perk', 'ticket', 'perk', 'One entry', '', 1),
          ('reward', 'venue', 'Reward', 'membership', 'reward', '', 'Free drink', 1),
          ('empty', 'venue', 'Empty', 'ticket', 'empty', '', '', 1);
        INSERT INTO card_stamp_settings (card_id, enabled, daily_limit, goal) VALUES ('both', 1, 2, 12);
      `)
      const before = db.prepare('SELECT id, issuer_id, slug, category FROM cards ORDER BY id').all()
      db.exec(readFileSync(new URL('0012_card_description.sql', migrations), 'utf-8'))

      expect(db.prepare('SELECT id, issuer_id, slug, category FROM cards ORDER BY id').all()).toStrictEqual(
        before,
      )
      expect(
        db
          .prepare('SELECT id, description FROM cards ORDER BY id')
          .all()
          .map((row) => ({ ...row })),
      ).toStrictEqual([
        { description: 'First line\nSecond line', id: 'both' },
        { description: '', id: 'empty' },
        { description: 'One entry', id: 'perk' },
        { description: 'Free drink', id: 'reward' },
      ])
      const columns = db
        .prepare('PRAGMA table_info(cards)')
        .all()
        .map((column) => column.name)
      expect(columns.filter((name) => name === 'perk' || name === 'reward')).toStrictEqual([])
      expect({
        foreignKeyViolations: db.prepare('PRAGMA foreign_key_check').all(),
        policy: db.prepare('SELECT enabled, goal FROM card_stamp_settings WHERE card_id = ?').get('both'),
      }).toMatchObject({ foreignKeyViolations: [], policy: { enabled: 1, goal: 12 } })
      db.exec(
        "INSERT INTO cards (id, issuer_id, title, category, slug, created_at) VALUES ('new', 'venue', 'New', 'membership', 'new', 1)",
      )
      expect(db.prepare('SELECT description FROM cards WHERE id = ?').get('new')).toMatchObject({
        description: '',
      })
    } finally {
      db.close()
    }
  })
})
