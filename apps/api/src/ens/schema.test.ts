import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client.ts'
import { ensNames } from './schema.ts'

const OWNER = `0x${'11'.repeat(20)}`
const TARGET = `0x${'22'.repeat(20)}`
const RIGHT_UID = `0x${'33'.repeat(32)}`

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

describe('ENS mirror schema', () => {
  it('persists Issuer and member names through Drizzle', async () => {
    const db = getDb({ DB: env.DB })
    await db.insert(ensNames).values([issuerRow, memberRow])

    const rows = await db.select().from(ensNames)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.kind === 'issuer')?.rightUid).toBeNull()
    expect(rows.find((row) => row.level === 'bearer')?.targetAddress).toBe(TARGET)
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
    ['a member name at a level that no longer exists', { ...memberRow, level: 'private' as 'bearer' }],
    ['a member name without a Right uid', { ...memberRow, rightUid: null }],
    ['a member name without a target', { ...memberRow, targetAddress: null }],
  ])('rejects %s', async (_case, row) => {
    const db = getDb({ DB: env.DB })
    await expect(db.insert(ensNames).values(row)).rejects.toThrow('Failed query')
  })
})
