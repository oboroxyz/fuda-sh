import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

describe('Card Stamp policy migration', () => {
  it('migrates existing Card policies while preserving credits and defaulting future Cards independently', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('PRAGMA foreign_keys = ON')
      const migrations = new URL('../migrations/', import.meta.url)
      for (const filename of readdirSync(migrations)
        .filter((name) => name.endsWith('.sql') && name < '0011')
        .toSorted()) {
        db.exec(readFileSync(new URL(filename, migrations), 'utf-8'))
      }
      db.exec(`
      INSERT INTO issuers (id, handle, name, brand_color, operator_address, created_at)
      VALUES ('venue', 'coffee', 'Coffee', '#112233', 'operator', 1);
      INSERT INTO cards (id, issuer_id, title, category, slug, created_at) VALUES
        ('membership', 'venue', 'Coffee membership', 'membership', 'coffee', 1),
        ('event', 'venue', 'Special event', 'ticket', 'event', 1);
      INSERT INTO stamp_settings (issuer_id, enabled, daily_limit, goal) VALUES ('venue', 1, 2, 12);
      INSERT INTO entry_log (id, uid, decision, reason, path, at, reception_id)
      VALUES (1, 'right', 'ADMIT', 'OK', 'qr', 1, 'request');
      INSERT INTO stamp_credits (issuer_id, uid, day, ordinal, at, operator_address, entry_log_id)
      VALUES ('venue', 'right', '2026-09-09', 1, 1, 'operator', 1);
      INSERT INTO reception_requests (id, issuer_id, uid, response, entry_log_id)
      VALUES ('request', 'venue', 'right', '{"decision":"ADMIT"}', 1);
    `)
      const credits = db.prepare('SELECT * FROM stamp_credits').all()
      const receipts = db.prepare('SELECT * FROM reception_requests').all()
      db.exec(readFileSync(new URL('0011_card_stamp_settings.sql', migrations), 'utf-8'))
      expect(
        db
          .prepare('SELECT * FROM card_stamp_settings ORDER BY card_id')
          .all()
          .map((row) => ({ ...row })),
      ).toStrictEqual([
        { card_id: 'event', daily_limit: 2, enabled: 1, goal: 12 },
        { card_id: 'membership', daily_limit: 2, enabled: 1, goal: 12 },
      ])
      expect({
        credits: db.prepare('SELECT * FROM stamp_credits').all(),
        receipts: db.prepare('SELECT * FROM reception_requests').all(),
      }).toStrictEqual({ credits, receipts })
      db.exec(
        "INSERT INTO cards (id, issuer_id, title, category, slug, created_at) VALUES ('new', 'venue', 'New card', 'ticket', 'new', 2)",
      )
      expect(db.prepare("SELECT * FROM card_stamp_settings WHERE card_id = 'new'").all()).toStrictEqual([])
      db.exec("UPDATE card_stamp_settings SET enabled = 0 WHERE card_id = 'event'")
      expect(
        db.prepare("SELECT enabled FROM card_stamp_settings WHERE card_id = 'membership'").get()?.enabled,
      ).toBe(1)
      expect(() => {
        db.exec("UPDATE card_stamp_settings SET daily_limit = 0 WHERE card_id = 'event'")
      }).toThrow('CHECK constraint failed')
    } finally {
      db.close()
    }
  })
})
