import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { CONFIRMATIONS, syncAnnouncements } from '../src/announcements/sync.ts'
import { ChainError } from '../src/chain/client.ts'
import type { FakeChain } from '../src/chain/fake-chain.ts'
import { getDb } from '../src/db/client.ts'
import { announcements, rateLimits, syncState } from '../src/db/schema.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, NOW, seedRoot } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })
const IP = { 'CF-Connecting-IP': '203.0.113.9' }

interface AnnouncementsBody {
  announcements: { blockNumber: number; logIndex: number; schemeId: number }[]
  syncedTo: number | null
}

const bodyOf = async (res: Response): Promise<AnnouncementsBody> => {
  const body: unknown = await res.json()
  return body as AnnouncementsBody
}

const blocksOf = (body: AnnouncementsBody): number[] => body.announcements.map((a) => a.blockNumber)

const announced = async (chain: ReturnType<typeof fakeChain>, n: number) => {
  for (let i = 0; i < n; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- announcements must land in block order
    await chain.announce({
      ephemeralPubKey: `0x02${'11'.repeat(32)}`,
      metadata: `0x${i.toString(16).padStart(2, '0')}${'ab'.repeat(32)}`,
      stealthAddress: `0x${'22'.repeat(20)}`,
    })
  }
}

// The sync stops CONFIRMATIONS blocks short of the head, so a test that wants
// the blocks it just announced to be syncable has to let the chain run on past
// them. The real `blockNumber` still runs first, so `failReads` keeps throwing.
const confirm = (chain: FakeChain): void => {
  const confirmed = chain.blockHeight + CONFIRMATIONS
  const real = chain.blockNumber.bind(chain)
  chain.blockNumber = async () => {
    await real()
    return confirmed
  }
}

const setup = () => {
  const chain = fakeChain()
  const del = seedRoot(chain)
  return {
    app: appWith({ chain, now: () => NOW }),
    bindings: configuredEnv(del, { ANNOUNCER_FROM_BLOCK: '100' }),
    chain,
  }
}

describe(syncAnnouncements, () => {
  beforeEach(async () => {
    await db().delete(announcements)
    await db().delete(syncState)
  })

  it('walks the chain in chunks and persists the cursor after each', async () => {
    const chain = fakeChain()
    await announced(chain, 3)
    confirm(chain)
    const ranges: [number, number][] = []
    const spy = chain.getAnnouncementLogs.bind(chain)
    chain.getAnnouncementLogs = async (from, to) => {
      ranges.push([from, to])
      return await spy(from, to)
    }
    const out = await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    expect(out).toStrictEqual({ ok: true, syncedTo: 103 })
    expect(ranges).toStrictEqual([[100, 103]])
    await expect(db().select().from(announcements)).resolves.toHaveLength(3)
    const cursor = await db().select().from(syncState)
    expect(cursor[0]).toStrictEqual({ key: 'announcements', value: 103 })
  })

  it('caps the chunks per request and continues from the cursor next time', async () => {
    const chain = fakeChain()
    // 5 chunks × 1000 blocks from 100 reaches 5099; the confirmed head (6105 - 5)
    // is well past that.
    for (let i = 0; i < 6000; i += 1) {
      chain.announcements.push({
        blockNumber: 101 + i,
        caller: chain.signerAddress() ?? `0x${'00'.repeat(20)}`,
        ephemeralPubKey: '0x02',
        logIndex: 0,
        metadata: '0x00',
        schemeId: 1,
        stealthAddress: `0x${'22'.repeat(20)}`,
        txHash: `0x${i.toString(16).padStart(64, '0')}`,
      })
    }
    chain.blockNumber = async () => await Promise.resolve(6105)
    const first = await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    expect(first).toStrictEqual({ ok: true, syncedTo: 5099 })
    const second = await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    expect(second).toStrictEqual({ ok: true, syncedTo: 6100 })
    await expect(db().select().from(announcements)).resolves.toHaveLength(6000)
  })

  it('reports the last good cursor when the RPC fails mid-way', async () => {
    const chain = fakeChain()
    await announced(chain, 1)
    confirm(chain)
    const first = await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    chain.failReads = true
    const second = await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    expect(first.ok).toBe(true)
    expect(second).toStrictEqual({ ok: false, syncedTo: 101 })
  })

  it('keeps the chunks that landed when the RPC fails on a later one', async () => {
    const chain = fakeChain()
    // 3500 blocks past the confirmed head (3604 - 5): four windows of <=1000,
    // the last one short.
    // One log per window, so the rows prove which chunks were committed.
    chain.blockNumber = async () => await Promise.resolve(3604)
    for (const blockNumber of [150, 1200, 2500, 3300]) {
      chain.announcements.push({
        blockNumber,
        caller: chain.signerAddress() ?? `0x${'00'.repeat(20)}`,
        ephemeralPubKey: '0x02',
        logIndex: 0,
        metadata: '0x00',
        schemeId: 1,
        stealthAddress: `0x${'22'.repeat(20)}`,
        txHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
      })
    }
    const ranges: [number, number][] = []
    const spy = chain.getAnnouncementLogs.bind(chain)
    chain.getAnnouncementLogs = async (from, to) => {
      ranges.push([from, to])
      if (ranges.length === 3) {
        throw new ChainError('rpc down')
      }
      return await spy(from, to)
    }
    const first = await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    // The two committed chunks survive the third one's failure.
    const landed = await db().select().from(announcements)
    const second = await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    expect(first).toStrictEqual({ ok: false, syncedTo: 2099 })
    expect(landed.map((row) => row.blockNumber).toSorted((a, b) => a - b)).toStrictEqual([150, 1200])
    expect(second).toStrictEqual({ ok: true, syncedTo: 3599 })
    expect(ranges).toStrictEqual([
      [100, 1099],
      [1100, 2099],
      [2100, 3099],
      [2100, 3099],
      [3100, 3599],
    ])
  })

  it('ignores a log it already holds', async () => {
    const chain = fakeChain()
    await announced(chain, 2)
    confirm(chain)
    await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    await db().delete(syncState)
    await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    await expect(db().select().from(announcements)).resolves.toHaveLength(2)
  })

  it('floors a persisted cursor below fromBlock - 1: the first requested range starts at fromBlock', async () => {
    const chain = fakeChain()
    chain.blockNumber = async () => await Promise.resolve(205)
    await db().insert(syncState).values({ key: 'announcements', value: 10 })
    const ranges: [number, number][] = []
    const spy = chain.getAnnouncementLogs.bind(chain)
    chain.getAnnouncementLogs = async (from, to) => {
      ranges.push([from, to])
      return await spy(from, to)
    }
    const out = await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    expect(out).toStrictEqual({ ok: true, syncedTo: 200 })
    expect(ranges).toStrictEqual([[100, 200]])
  })

  it('stops CONFIRMATIONS blocks short of the head', async () => {
    // The fake's head is 100, so the confirmed head is 95: the five newest
    // blocks are left for the next request, when they cannot be re-org'd out.
    const chain = fakeChain()
    const ranges: [number, number][] = []
    const spy = chain.getAnnouncementLogs.bind(chain)
    chain.getAnnouncementLogs = async (from, to) => {
      ranges.push([from, to])
      return await spy(from, to)
    }
    const out = await syncAnnouncements({ chain, db: db(), fromBlock: 50 })
    await expect(chain.blockNumber()).resolves.toBe(100)
    expect(out).toStrictEqual({ ok: true, syncedTo: 95 })
    expect(ranges).toStrictEqual([[50, 95]])
  })

  it('never lets a concurrent slower sync lower the persisted cursor', async () => {
    const chain = fakeChain()
    chain.blockNumber = async () => await Promise.resolve(205)
    // A faster request lands its own, higher cursor while this walk is reading
    // its chunk; the chunk's own `to` (200) must not pull it back.
    const spy = chain.getAnnouncementLogs.bind(chain)
    chain.getAnnouncementLogs = async (from, to) => {
      await db().insert(syncState).values({ key: 'announcements', value: 9999 })
      return await spy(from, to)
    }
    const out = await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    const cursor = await db().select().from(syncState)
    expect(out).toStrictEqual({ ok: true, syncedTo: 200 })
    expect(cursor[0]).toStrictEqual({ key: 'announcements', value: 9999 })
  })

  it('keeps a persisted cursor above fromBlock - 1', async () => {
    const chain = fakeChain()
    chain.blockNumber = async () => await Promise.resolve(505)
    await db().insert(syncState).values({ key: 'announcements', value: 300 })
    const ranges: [number, number][] = []
    const spy = chain.getAnnouncementLogs.bind(chain)
    chain.getAnnouncementLogs = async (from, to) => {
      ranges.push([from, to])
      return await spy(from, to)
    }
    const out = await syncAnnouncements({ chain, db: db(), fromBlock: 100 })
    expect(out).toStrictEqual({ ok: true, syncedTo: 500 })
    expect(ranges).toStrictEqual([[301, 500]])
  })
})

describe('GET /announcements', () => {
  beforeEach(async () => {
    await db().delete(announcements)
    await db().delete(syncState)
    await db().delete(rateLimits)
  })

  it('serves synced rows in block order with the cursor', async () => {
    const { app, bindings, chain } = setup()
    await announced(chain, 2)
    confirm(chain)
    const res = await app.request('/announcements', { headers: IP }, bindings)
    const body = await bodyOf(res)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(body.syncedTo).toBe(102)
    expect(blocksOf(body)).toStrictEqual([101, 102])
    expect(body.announcements[0]).toMatchObject({ logIndex: 0, schemeId: 1 })
  })

  it('filters by fromBlock', async () => {
    const { app, bindings, chain } = setup()
    await announced(chain, 3)
    confirm(chain)
    const res = await app.request('/announcements?fromBlock=103', { headers: IP }, bindings)
    expect(blocksOf(await bodyOf(res))).toStrictEqual([103])
  })

  it('answers 502 rpc_unavailable when the RPC is down and nothing is cached', async () => {
    const { app, bindings, chain } = setup()
    chain.failReads = true
    const res = await app.request('/announcements', { headers: IP }, bindings)
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toStrictEqual({ error: 'rpc_unavailable' })
  })

  it('serves the stale cache when the RPC is down but something is cached', async () => {
    const { app, bindings, chain } = setup()
    await announced(chain, 1)
    confirm(chain)
    await app.request('/announcements', { headers: IP }, bindings)
    chain.failReads = true
    const res = await app.request('/announcements', { headers: IP }, bindings)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ syncedTo: 101 })
  })

  it('answers 502 without touching the chain when ANNOUNCER_FROM_BLOCK is unset', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    // A plain Error, not a ChainError: were it called, the route would answer
    // 500 rather than fold the call into the 502 this test expects.
    chain.blockNumber = async () => await Promise.reject(new Error('must not be called'))
    chain.getAnnouncementLogs = async () => await Promise.reject(new Error('must not be called'))
    const app = appWith({ chain, now: () => NOW })
    const bindings = configuredEnv(del, { ANNOUNCER_FROM_BLOCK: '0' })
    const res = await app.request('/announcements', { headers: IP }, bindings)
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toStrictEqual({ error: 'rpc_unavailable' })
    await expect(db().select().from(syncState)).resolves.toHaveLength(0)
  })

  it('syncs normally when ANNOUNCER_FROM_BLOCK is a positive block', async () => {
    const { app, bindings, chain } = setup()
    await announced(chain, 1)
    confirm(chain)
    const res = await app.request('/announcements', { headers: IP }, bindings)
    expect(res.status).toBe(200)
    expect(blocksOf(await bodyOf(res))).toStrictEqual([101])
  })

  it('requires a client ip and answers 400 without one', async () => {
    const { app, bindings } = setup()
    const res = await app.request('/announcements', {}, bindings)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toStrictEqual({ error: 'client_ip_required' })
  })

  it('is budgeted at 120 per hour per ip, while POST /verify is not', async () => {
    const { app, bindings } = setup()
    await db()
      .insert(rateLimits)
      .values({ count: 120, ip: '203.0.113.9', windowStart: Math.floor(NOW / 3600) * 3600 })
    const limited = await app.request('/announcements', { headers: IP }, bindings)
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toStrictEqual({ error: 'rate_limited' })
    const verify = await app.request(
      '/verify',
      {
        body: JSON.stringify({ qr: `fuda:v1:0x${'ab'.repeat(32)}` }),
        headers: { ...IP, 'content-type': 'application/json' },
        method: 'POST',
      },
      bindings,
    )
    expect(verify.status).toBe(200)
  })
})
