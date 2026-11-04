import { env } from 'cloudflare:test'
import { eq, isNull } from 'drizzle-orm'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { members, offchainAttestations, offchainRoots } from '../src/db/schema.ts'
import { merkleRoot } from '../src/eas/merkle.ts'
import { anchorOffchainRoots, retryOffchainRevocations } from '../src/passes/offchain-chores.ts'
import { fakeChain } from './env.ts'
import { NOW, ROOT } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })

const uidOf = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`

const insertPasses = async (from: number, count: number, status: 'active' | 'revoked' = 'active') => {
  for (let i = from; i < from + count; i += 1) {
    const uid = uidOf(i)
    // oxlint-disable-next-line no-await-in-loop -- fixture rows, in a test
    await db().batch([
      db()
        .insert(members)
        .values({ attestationUid: uid, createdAt: NOW, level: 'bearer', memberId: `m${i}`, status }),
      db()
        .insert(offchainAttestations)
        .values({ createdAt: NOW + i, signed: '{}', uid }),
    ])
  }
}

const passRoots = async () => {
  const rows = await db().select({ root: offchainAttestations.root }).from(offchainAttestations)
  return rows.map((row) => row.root)
}

describe('offchain chores', () => {
  beforeEach(async () => {
    await db().delete(offchainRoots)
    await db().delete(offchainAttestations)
    await db().delete(members)
  })

  describe(anchorOffchainRoots, () => {
    it('sends nothing when there are no new passes', async () => {
      const chain = fakeChain({ signer: ROOT })
      await anchorOffchainRoots(db(), chain, NOW)
      expect(chain.txs).toHaveLength(0)
      await expect(db().select().from(offchainRoots)).resolves.toHaveLength(0)
    })

    it('timestamps one root over the new passes and ties them to it', async () => {
      const chain = fakeChain({ signer: ROOT })
      await insertPasses(1, 3)
      await anchorOffchainRoots(db(), chain, NOW)
      const root = merkleRoot([uidOf(1), uidOf(2), uidOf(3)])
      await expect(chain.rootTimestamp(root)).resolves.not.toBe(0n)
      const [row] = await db().select().from(offchainRoots)
      expect(row).toMatchObject({ createdAt: NOW, passCount: 3, root })
      expect(row?.anchoredAt).not.toBeNull()
      expect(row?.txHash).toMatch(/^0x/u)
      await expect(passRoots()).resolves.toStrictEqual([root, root, root])
    })

    it('never puts a pass in two roots', async () => {
      const chain = fakeChain({ signer: ROOT })
      await insertPasses(1, 2)
      await anchorOffchainRoots(db(), chain, NOW)
      await insertPasses(3, 2)
      await anchorOffchainRoots(db(), chain, NOW + 3600)
      const roots = await db().select().from(offchainRoots)
      expect(roots.map((row) => row.passCount)).toStrictEqual([2, 2])
      expect(new Set(await passRoots()).size).toBe(2)
    })

    it('takes more uids than one D1 statement allows', async () => {
      const chain = fakeChain({ signer: ROOT })
      await insertPasses(1, 150)
      await anchorOffchainRoots(db(), chain, NOW)
      await expect(
        db().select().from(offchainAttestations).where(isNull(offchainAttestations.root)),
      ).resolves.toHaveLength(0)
    })

    it('retries the same root after a failed send, with new passes kept for the next one', async () => {
      const chain = fakeChain({ signer: ROOT })
      await insertPasses(1, 2)
      chain.failWrites = true
      await anchorOffchainRoots(db(), chain, NOW)
      const [unsent] = await db().select().from(offchainRoots)
      expect(unsent?.anchoredAt).toBeNull()
      await insertPasses(3, 1)
      chain.failWrites = false
      await anchorOffchainRoots(db(), chain, NOW + 3600)
      const roots = await db().select().from(offchainRoots).orderBy(offchainRoots.createdAt)
      expect(roots.map((row) => row.root)[0]).toBe(merkleRoot([uidOf(1), uidOf(2)]))
      expect(roots.map((row) => row.passCount)).toStrictEqual([2, 1])
      expect(roots.every((row) => row.anchoredAt !== null)).toBe(true)
    })

    it('counts a root someone else timestamped first as done', async () => {
      const chain = fakeChain({ signer: ROOT })
      await insertPasses(1, 2)
      await chain.timestamp(merkleRoot([uidOf(1), uidOf(2)]))
      const before = chain.txs.length
      await anchorOffchainRoots(db(), chain, NOW)
      expect(chain.txs).toHaveLength(before)
      const [row] = await db().select().from(offchainRoots)
      expect(row?.anchoredAt).not.toBeNull()
      expect(row?.txHash).toBeNull()
    })

    it('leaves the root unsent while the chain cannot be read', async () => {
      const chain = fakeChain({ signer: ROOT })
      await insertPasses(1, 1)
      chain.failReads = true
      await expect(anchorOffchainRoots(db(), chain, NOW)).resolves.toBeUndefined()
      const [row] = await db().select().from(offchainRoots)
      expect(row?.anchoredAt).toBeNull()
    })

    it('does nothing without a signer', async () => {
      await insertPasses(1, 1)
      await anchorOffchainRoots(db(), fakeChain({ signer: null }), NOW)
      await expect(db().select().from(offchainRoots)).resolves.toHaveLength(0)
    })
  })

  describe(retryOffchainRevocations, () => {
    it('sends what is behind and marks it', async () => {
      const chain = fakeChain({ signer: ROOT })
      await insertPasses(1, 2, 'revoked')
      await expect(retryOffchainRevocations(db(), chain)).resolves.toBe(2)
      const rows = await db().select().from(offchainAttestations)
      expect(rows.every((row) => row.revokeTx?.startsWith('0x') === true)).toBe(true)
    })

    it('leaves active passes alone', async () => {
      const chain = fakeChain({ signer: ROOT })
      await insertPasses(1, 1)
      await expect(retryOffchainRevocations(db(), chain)).resolves.toBe(0)
      expect(chain.txs).toHaveLength(0)
    })

    it('does not send again once sent', async () => {
      const chain = fakeChain({ signer: ROOT })
      await insertPasses(1, 1, 'revoked')
      await retryOffchainRevocations(db(), chain)
      const before = chain.txs.length
      await expect(retryOffchainRevocations(db(), chain)).resolves.toBe(0)
      expect(chain.txs).toHaveLength(before)
    })

    it('marks a pass the chain already shows as revoked, with no transaction', async () => {
      const chain = fakeChain({ signer: ROOT })
      await insertPasses(1, 1, 'revoked')
      await chain.revokeOffchain(uidOf(1))
      const before = chain.txs.length
      await retryOffchainRevocations(db(), chain)
      expect(chain.txs).toHaveLength(before)
      const row = await db()
        .select()
        .from(offchainAttestations)
        .where(eq(offchainAttestations.uid, uidOf(1)))
        .get()
      expect(row?.revokeTx).toBe(`0x${'00'.repeat(32)}`)
    })

    it('stops at the first failure and keeps the rest for the next run', async () => {
      const chain = fakeChain({ signer: ROOT })
      await insertPasses(1, 3, 'revoked')
      chain.failWrites = true
      await expect(retryOffchainRevocations(db(), chain)).resolves.toBe(0)
      chain.failWrites = false
      await expect(retryOffchainRevocations(db(), chain)).resolves.toBe(3)
    })

    it('takes twenty at a time', async () => {
      const chain = fakeChain({ signer: ROOT })
      await insertPasses(1, 21, 'revoked')
      await expect(retryOffchainRevocations(db(), chain)).resolves.toBe(20)
      await expect(retryOffchainRevocations(db(), chain)).resolves.toBe(1)
    })
  })
})
