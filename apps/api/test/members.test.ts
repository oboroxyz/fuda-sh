import type { Hex, MemberRow } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { saveBadge } from '../src/badges/store.ts'
import { getDb } from '../src/db/client.ts'
import { members } from '../src/db/schema.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRoot } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })

const numberedUid = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`

const memberValues = (uid: Hex, createdAt: number) => ({
  attestationUid: uid,
  createdAt,
  holder: null,
  level: 'bearer' as const,
  memberId: `m${createdAt}`,
  status: 'active' as const,
  tier: 0,
})

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
    const res = await app.request('/v1/members', {}, configuredEnv(del))
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
    const res = await app.request('/v1/members', {}, configuredEnv(del))
    const body: { members: unknown[] } = await res.json()
    expect(body.members).toHaveLength(200)
  })

  // The fill order here is the shape the dashboard's Verified human column reads:
  // a badged row carries the fact of the badge, an unbadged one carries no key.
  it('carries a badge on the badged right and no badges key on the rest', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const badged = numberedUid(0xb1)
    const plain = numberedUid(0xb2)
    await db()
      .insert(members)
      .values([memberValues(badged, 1), memberValues(plain, 2)])
    await saveBadge(db(), {
      credential: 'orb',
      expiresAt: null,
      kind: 'human',
      scope: 'members-list',
      subjectKey: '0xsubject-one',
      uid: badged,
      verifiedAt: NOW,
      verifier: 'world',
    })
    const app = appWith({ chain, now: () => NOW })
    const res = await app.request('/v1/members', {}, configuredEnv(del))
    expect(res.status).toBe(200)
    const body: { members: MemberRow[] } = await res.json()
    const rows = new Map(body.members.map((m) => [m.uid, m]))
    expect(rows.get(badged)?.badges).toStrictEqual([{ at: NOW, kind: 'human', verifier: 'world' }])
    expect(rows.get(plain)).not.toHaveProperty('badges')
  })

  // A full page is 200 uids and D1 binds at most 100 values per statement, so the
  // badge read is several statements. Badging the first and the last listed right
  // fails unless every batch is issued and its rows merged back onto the page.
  it('merges badges across uid batches for a page of more than 100 rights', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const count = 150
    const rows = Array.from({ length: count }, (_, i) => memberValues(numberedUid(0x10_00 + i), i))
    for (let i = 0; i < rows.length; i += 10) {
      // oxlint-disable-next-line no-await-in-loop -- D1 rejects a 150-row multi-insert in one statement; chunking keeps the values list under the SQL variable limit
      await db()
        .insert(members)
        .values(rows.slice(i, i + 10))
    }
    // Listed newest first, so the highest createdAt leads the page and lands in the
    // first batch while the lowest lands in the last.
    const first = numberedUid(0x10_00 + count - 1)
    const last = numberedUid(0x10_00)
    const middle = numberedUid(0x10_00 + 75)
    for (const [index, uid] of [first, last].entries()) {
      // oxlint-disable-next-line no-await-in-loop -- saveBadge reads before it writes; two sequential saves keep the subject uniqueness check deterministic
      await saveBadge(db(), {
        credential: 'orb',
        expiresAt: null,
        kind: 'human',
        scope: 'members-page',
        subjectKey: `0xsubject-page-${index}`,
        uid,
        verifiedAt: NOW,
        verifier: 'world',
      })
    }
    const app = appWith({ chain, now: () => NOW })
    const res = await app.request('/v1/members', {}, configuredEnv(del))
    expect(res.status).toBe(200)
    const body: { members: MemberRow[] } = await res.json()
    const listed = new Map(body.members.map((m) => [m.uid, m]))
    const human = [{ at: NOW, kind: 'human', verifier: 'world' }]
    expect({
      count: body.members.length,
      firstBadges: listed.get(first)?.badges,
      lastBadges: listed.get(last)?.badges,
      leads: body.members[0]?.uid,
      middleHasKey: Object.hasOwn(listed.get(middle) ?? {}, 'badges'),
    }).toStrictEqual({
      count,
      firstBadges: human,
      lastBadges: human,
      leads: first,
      middleHasKey: false,
    })
  })

  it('requires the admin token when set', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const res = await app.request('/v1/members', {}, configuredEnv(del, { ADMIN_TOKEN: 's' }))
    expect(res.status).toBe(401)
  })

  // Last in the file: dropping the table is not undone for the tests after it.
  it('still lists rights when the badge store is missing, only without badges', async () => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const uid = numberedUid(0xde_ad)
    await db()
      .insert(members)
      .values([memberValues(uid, 1)])
    await env.DB.exec('DROP TABLE badges')
    const app = appWith({ chain, now: () => NOW })
    const res = await app.request('/v1/members', {}, configuredEnv(del))
    expect(res.status).toBe(200)
    const body: { members: MemberRow[] } = await res.json()
    expect(body.members.map((m) => m.uid)).toStrictEqual([uid])
    expect(body.members[0]).not.toHaveProperty('badges')
  })
})
