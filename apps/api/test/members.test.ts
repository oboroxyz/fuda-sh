import type { MemberRow } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { members } from '../src/db/schema.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRoot } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })

describe('GET /members', () => {
  // Storage is shared across the tests in this file, so start each test with an empty table.
  beforeEach(async () => {
    await db().delete(members)
  })

  it('lists rows newest first with the camelCase shape, private rows with holder null', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    await db()
      .insert(members)
      .values([
        {
          attestationUid: `0x${'01'.repeat(32)}`,
          createdAt: NOW - 10,
          holder: `0x${'11'.repeat(20)}`,
          level: 'bearer',
          memberId: 'old',
          status: 'active',
          tier: 0,
        },
        {
          attestationUid: `0x${'02'.repeat(32)}`,
          createdAt: NOW,
          holder: null,
          level: 'private',
          memberId: '',
          status: 'active',
          tier: 2,
        },
        {
          attestationUid: `0x${'03'.repeat(32)}`,
          createdAt: NOW - 5,
          holder: `0x${'22'.repeat(20)}`,
          level: 'signed',
          memberId: 'mid',
          status: 'revoked',
          tier: 1,
        },
      ])
    const app = appWith({ chain, now: () => NOW })
    const res = await app.request('/members', {}, configuredEnv(del))
    expect(res.status).toBe(200)
    const body: { members: MemberRow[] } = await res.json()
    expect(body.members.map((m) => m.uid)).toStrictEqual([
      `0x${'02'.repeat(32)}`,
      `0x${'03'.repeat(32)}`,
      `0x${'01'.repeat(32)}`,
    ])
    expect(body.members[0]).toStrictEqual({
      createdAt: NOW,
      holder: null,
      level: 'private',
      memberId: '',
      status: 'active',
      tier: 2,
      uid: `0x${'02'.repeat(32)}`,
    })
  })

  it('caps at 200 rows', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const rows = Array.from({ length: 205 }, (_, i) => ({
      attestationUid: `0x${i.toString(16).padStart(64, '0')}`,
      createdAt: i,
      holder: null,
      level: 'bearer' as const,
      memberId: `m${i}`,
      status: 'active' as const,
      tier: 0,
    }))
    for (let i = 0; i < rows.length; i += 10) {
      // oxlint-disable-next-line no-await-in-loop -- D1 rejects a 205-row multi-insert in one statement; chunking keeps the values list under the SQL variable limit
      await db()
        .insert(members)
        .values(rows.slice(i, i + 10))
    }
    const app = appWith({ chain, now: () => NOW })
    const res = await app.request('/members', {}, configuredEnv(del))
    const body: { members: unknown[] } = await res.json()
    expect(body.members).toHaveLength(200)
  })

  it('requires the admin token when set', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const res = await app.request('/members', {}, configuredEnv(del, { ADMIN_TOKEN: 's' }))
    expect(res.status).toBe(401)
  })
})
