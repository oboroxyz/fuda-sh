import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client.ts'
import { ensNames, stealthResolutions } from './schema.ts'

const OWNER = `0x${'11'.repeat(20)}`
const TARGET = `0x${'22'.repeat(20)}`
const RIGHT_UID = `0x${'33'.repeat(32)}`
const META_ADDRESS = `0x${'44'.repeat(66)}`
const EPHEMERAL_PUBLIC_KEY = `0x02${'55'.repeat(32)}`

const issuerRow = {
  createdAt: 1,
  issuerHandle: 'coffee',
  kind: 'issuer' as const,
  name: 'coffee.fuda.eth',
  ownerAddress: OWNER,
  status: 'offchain' as const,
  targetAddress: TARGET,
  updatedAt: 1,
}

const memberRow = {
  createdAt: 1,
  issuerHandle: 'coffee',
  kind: 'member' as const,
  level: 'bearer' as const,
  name: 'qj2yxphepdrka.coffee.fuda.eth',
  ownerAddress: OWNER,
  rightUid: RIGHT_UID,
  status: 'offchain' as const,
  targetAddress: TARGET,
  updatedAt: 1,
}

const privateRow = {
  createdAt: 1,
  issuerHandle: 'coffee',
  kind: 'member' as const,
  level: 'private' as const,
  name: '3wxkr3akmw4j2.coffee.fuda.eth',
  ownerAddress: OWNER,
  rightUid: `0x${'66'.repeat(32)}`,
  status: 'offchain' as const,
  stealthMetaAddress: META_ADDRESS,
  updatedAt: 1,
}

describe('ENS mirror schema', () => {
  it('persists Issuer, stable member, and +Private member names through Drizzle', async () => {
    const db = getDb({ DB: env.DB })
    await db.insert(ensNames).values([issuerRow, memberRow, privateRow])

    const rows = await db.select().from(ensNames)
    expect(rows).toHaveLength(3)
    expect(rows.find((row) => row.kind === 'issuer')?.rightUid).toBeNull()
    expect(rows.every((row) => row.resolutionCounter === 0)).toBe(true)
    expect(rows.find((row) => row.level === 'bearer')?.targetAddress).toBe(TARGET)
    expect(rows.find((row) => row.level === 'private')?.stealthMetaAddress).toBe(META_ADDRESS)
  })

  it('rejects duplicate canonical names', async () => {
    const db = getDb({ DB: env.DB })
    const uniqueRow = { ...issuerRow, issuerHandle: 'tea', name: 'tea.fuda.eth' }
    await db.insert(ensNames).values(uniqueRow)
    await expect(db.insert(ensNames).values({ ...uniqueRow, issuerHandle: 'bakery' })).rejects.toThrow(
      'Failed query',
    )
  })

  it.each([
    ['an Issuer name carrying Right evidence', { ...issuerRow, rightUid: RIGHT_UID }],
    ['a member name without a Right uid', { ...memberRow, rightUid: null }],
    ['a +Private name with a stable target', { ...privateRow, targetAddress: TARGET }],
    ['a +Private name without a stealth meta-address', { ...privateRow, stealthMetaAddress: null }],
    ['a stable member name without a target', { ...memberRow, targetAddress: null }],
  ])('rejects %s', async (_case, row) => {
    const db = getDb({ DB: env.DB })
    await expect(db.insert(ensNames).values(row)).rejects.toThrow('Failed query')
  })

  it('keeps the nonce counter and derived stealth address unique', async () => {
    const db = getDb({ DB: env.DB })
    const inserted = await db
      .insert(ensNames)
      .values({ ...privateRow, issuerHandle: 'tea', name: '3wxkr3akmw4j2.tea.fuda.eth' })
      .returning({ id: ensNames.id })
    const ensNameId = inserted[0]?.id
    expect(ensNameId).toBeTypeOf('number')
    if (ensNameId === undefined) {
      throw new Error('expected inserted ENS name id')
    }

    const resolution = {
      ensNameId,
      ephemeralPublicKey: EPHEMERAL_PUBLIC_KEY,
      nonceCounter: 0,
      resolvedAt: 2,
      stealthAddress: TARGET,
      viewTag: '0x01',
    }
    await db.insert(stealthResolutions).values(resolution)

    await expect(
      db.insert(stealthResolutions).values({ ...resolution, stealthAddress: OWNER }),
    ).rejects.toThrow('Failed query')
    await expect(db.insert(stealthResolutions).values({ ...resolution, nonceCounter: 1 })).rejects.toThrow(
      'Failed query',
    )
  })
})
