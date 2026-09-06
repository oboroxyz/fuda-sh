import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client.ts'
import { lookupEnsName } from './lookup.ts'
import { ensNames } from './schema.ts'

const OWNER = `0x${'11'.repeat(20)}`
const TARGET = `0x${'22'.repeat(20)}`
const META_ADDRESS = `0x${'44'.repeat(66)}`

const insertIssuerName = async (
  handle: string,
  overrides: Partial<typeof ensNames.$inferInsert> = {},
): Promise<void> => {
  const db = getDb({ DB: env.DB })
  await db.insert(ensNames).values({
    createdAt: 1,
    issuerHandle: handle,
    kind: 'issuer',
    name: `${handle}.fuda.eth`,
    ownerAddress: OWNER,
    status: 'offchain',
    targetAddress: TARGET,
    updatedAt: 1,
    ...overrides,
  })
}

describe('ENS lookup', () => {
  it('returns the stable target of an active offchain Issuer name', async () => {
    await insertIssuerName('bakery')

    await expect(
      lookupEnsName(getDb({ DB: env.DB }), {
        name: 'BAKERY.FUDA.ETH.',
        now: 10,
        parentName: 'fuda.eth',
      }),
    ).resolves.toStrictEqual({ address: TARGET, type: 'address' })
  })

  it('returns a derivation instruction without allocating a +Private address', async () => {
    const db = getDb({ DB: env.DB })
    const inserted = await db
      .insert(ensNames)
      .values({
        createdAt: 1,
        issuerHandle: 'coffee',
        kind: 'member',
        level: 'private',
        name: '23456789acded.coffee.fuda.eth',
        ownerAddress: OWNER,
        rightUid: `0x${'33'.repeat(32)}`,
        status: 'offchain',
        stealthMetaAddress: META_ADDRESS,
        updatedAt: 1,
      })
      .returning({ id: ensNames.id })

    await expect(
      lookupEnsName(db, {
        name: '23456789acded.coffee.fuda.eth',
        now: 10,
        parentName: 'fuda.eth',
      }),
    ).resolves.toStrictEqual({
      ensNameId: inserted[0]?.id,
      stealthMetaAddress: META_ADDRESS,
      type: 'stealth',
    })
    const rows = await env.DB.prepare('SELECT COUNT(*) AS count FROM stealth_resolutions').first<{
      count: number
    }>()
    expect(rows?.count).toBe(0)
  })

  it.each([
    ['failed', 'gallery'],
    ['unregistered', 'office'],
  ] as const)('hides a %s name', async (status, handle) => {
    await insertIssuerName(handle, { status })
    await expect(
      lookupEnsName(getDb({ DB: env.DB }), {
        name: `${handle}.fuda.eth`,
        now: 10,
        parentName: 'fuda.eth',
      }),
    ).resolves.toBeNull()
  })

  it('hides an expired name but includes its exact expiry instant', async () => {
    await insertIssuerName('expired', { expiry: 9 })
    await insertIssuerName('boundary', { expiry: 10 })
    const db = getDb({ DB: env.DB })

    await expect(
      lookupEnsName(db, { name: 'expired.fuda.eth', now: 10, parentName: 'fuda.eth' }),
    ).resolves.toBeNull()
    await expect(
      lookupEnsName(db, { name: 'boundary.fuda.eth', now: 10, parentName: 'fuda.eth' }),
    ).resolves.toStrictEqual({ address: TARGET, type: 'address' })
  })

  it.each(['unknown.fuda.eth', 'bakery.other.eth', 'too.deep.bakery.fuda.eth'])(
    'returns null for an unknown, foreign, or unsupported name %s',
    async (name) => {
      await expect(
        lookupEnsName(getDb({ DB: env.DB }), { name, now: 10, parentName: 'fuda.eth' }),
      ).resolves.toBeNull()
    },
  )

  it('keeps a claimed member name visible through the future Issuer wildcard resolver', async () => {
    const db = getDb({ DB: env.DB })
    await db.insert(ensNames).values({
      createdAt: 1,
      issuerHandle: 'club',
      kind: 'member',
      level: 'signed',
      name: '3456789acdefq.club.fuda.eth',
      ownerAddress: OWNER,
      rightUid: `0x${'55'.repeat(32)}`,
      status: 'claimed',
      targetAddress: TARGET,
      updatedAt: 1,
    })

    await expect(
      lookupEnsName(db, {
        name: '3456789acdefq.club.fuda.eth',
        now: 10,
        parentName: 'fuda.eth',
      }),
    ).resolves.toStrictEqual({ address: TARGET, type: 'address' })
  })

  it('does not expose a malformed persisted address', async () => {
    await insertIssuerName('malformed', { targetAddress: 'not-an-address' })

    await expect(
      lookupEnsName(getDb({ DB: env.DB }), {
        name: 'malformed.fuda.eth',
        now: 10,
        parentName: 'fuda.eth',
      }),
    ).resolves.toBeNull()
  })
})
