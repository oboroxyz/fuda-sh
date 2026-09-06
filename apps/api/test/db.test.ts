import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { members, slots } from '../src/db/schema.ts'

describe('D1 schema', () => {
  it('has every application table after migration', async () => {
    const rows = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%'",
    ).all<{ name: string }>()
    expect(rows.results.map((r) => r.name).toSorted()).toStrictEqual([
      'announcements',
      'challenges',
      'ens_names',
      'entry_log',
      'members',
      'rate_limits',
      'slots',
      'stealth_resolutions',
      'sync_state',
    ])
  })

  it('inserts a member row through drizzle', async () => {
    const db = getDb({ DB: env.DB })
    await db.insert(members).values({
      attestationUid: `0x${'01'.repeat(32)}`,
      createdAt: 1,
      holder: `0x${'11'.repeat(20)}`,
      level: 'bearer',
      memberId: 'alice',
      status: 'active',
      tier: 0,
    })
    const all = await db.select().from(members)
    expect(all).toHaveLength(1)
    expect(all[0]?.level).toBe('bearer')
  })

  it('INSERT OR IGNORE on slots reports changes', async () => {
    const db = getDb({ DB: env.DB })
    const uid = `0x${'02'.repeat(32)}`
    const first = await db
      .insert(slots)
      .values({ consumedAt: 1, slot: 'default', uid })
      .onConflictDoNothing()
      .run()
    const second = await db
      .insert(slots)
      .values({ consumedAt: 2, slot: 'default', uid })
      .onConflictDoNothing()
      .run()
    expect(first.meta.changes).toBe(1)
    expect(second.meta.changes).toBe(0)
  })
})
