import { deriveMemberSecret, deriveStealthKeys } from '@fuda/stealth-address'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client.ts'
import { allocateStealthResolution, deriveResolutionEphemeralKey } from './resolution.ts'
import { ensNames, stealthResolutions } from './schema.ts'

const OWNER = `0x${'11'.repeat(20)}`
const GATEWAY_SECRET = `0x${'a5'.repeat(32)}` as const
const META_ADDRESS = deriveStealthKeys(deriveMemberSecret(new Uint8Array(32).fill(7))).metaAddress

const insertPrivateName = async (
  name: string,
  overrides: Partial<typeof ensNames.$inferInsert> = {},
): Promise<number> => {
  const db = getDb({ DB: env.DB })
  const [row] = await db
    .insert(ensNames)
    .values({
      createdAt: 1,
      issuerHandle: name.split('.')[1] ?? 'coffee',
      kind: 'member',
      level: 'private',
      name,
      ownerAddress: OWNER,
      rightUid: `0x${crypto.randomUUID().replaceAll('-', '').padEnd(64, '0')}`,
      status: 'offchain',
      stealthMetaAddress: META_ADDRESS,
      updatedAt: 1,
      ...overrides,
    })
    .returning({ id: ensNames.id })
  if (row === undefined) {
    throw new Error('expected inserted ENS name')
  }
  return row.id
}

describe('ENS +Private resolution allocation', () => {
  it('derives the same valid key for the same name and counter', async () => {
    const first = await deriveResolutionEphemeralKey({
      counter: 4,
      gatewaySecret: GATEWAY_SECRET,
      name: '23456789acded.coffee.fuda.eth',
    })
    const second = await deriveResolutionEphemeralKey({
      counter: 4,
      gatewaySecret: GATEWAY_SECRET,
      name: '23456789acded.coffee.fuda.eth',
    })
    expect(first).toStrictEqual(second)
    expect(first).toHaveLength(32)
    expect(first.some((byte) => byte !== 0)).toBe(true)
  })

  it('atomically reserves distinct counters and records distinct destinations', async () => {
    const db = getDb({ DB: env.DB })
    const name = '23456789acded.coffee.fuda.eth'
    const ensNameId = await insertPrivateName(name)

    const [first, second] = await Promise.all([
      allocateStealthResolution(db, {
        ensNameId,
        expiresAt: 80,
        gatewaySecret: GATEWAY_SECRET,
        name,
        now: 20,
      }),
      allocateStealthResolution(db, {
        ensNameId,
        expiresAt: 81,
        gatewaySecret: GATEWAY_SECRET,
        name,
        now: 21,
      }),
    ])

    expect(first?.stealthAddress).not.toBe(second?.stealthAddress)
    const rows = await db.select().from(stealthResolutions).where(eq(stealthResolutions.ensNameId, ensNameId))
    const [nameRow] = await db
      .select({ resolutionCounter: ensNames.resolutionCounter })
      .from(ensNames)
      .where(eq(ensNames.id, ensNameId))
    expect({
      allocatedCounters: [first?.nonceCounter, second?.nonceCounter].toSorted(
        (left, right) => (left ?? -1) - (right ?? -1),
      ),
      persisted: rows
        .map((row) => ({ expiresAt: row.expiresAt, nonceCounter: row.nonceCounter }))
        .toSorted((left, right) => left.nonceCounter - right.nonceCounter),
      resolutionCounter: nameRow?.resolutionCounter,
    }).toStrictEqual({
      allocatedCounters: [0, 1],
      persisted: [
        { expiresAt: 80, nonceCounter: 0 },
        { expiresAt: 81, nonceCounter: 1 },
      ],
      resolutionCounter: 2,
    })
  })

  it('does not reserve a counter for inactive or expired names', async () => {
    const db = getDb({ DB: env.DB })
    const inactiveId = await insertPrivateName('3456789acdefq.club.fuda.eth', {
      issuerHandle: 'club',
      status: 'unregistered',
    })
    const expiredId = await insertPrivateName('456789acdefg4.office.fuda.eth', {
      expiry: 9,
      issuerHandle: 'office',
    })

    await expect(
      allocateStealthResolution(db, {
        ensNameId: inactiveId,
        gatewaySecret: GATEWAY_SECRET,
        name: '3456789acdefq.club.fuda.eth',
        now: 10,
      }),
    ).resolves.toBeNull()
    await expect(
      allocateStealthResolution(db, {
        ensNameId: expiredId,
        gatewaySecret: GATEWAY_SECRET,
        name: '456789acdefg4.office.fuda.eth',
        now: 10,
      }),
    ).resolves.toBeNull()
  })

  it('rejects a malformed secret before consuming a counter', async () => {
    const db = getDb({ DB: env.DB })
    const name = '56789acdefghe.studio.fuda.eth'
    const ensNameId = await insertPrivateName(name, { issuerHandle: 'studio' })

    await expect(
      allocateStealthResolution(db, {
        ensNameId,
        gatewaySecret: '0x1234',
        name,
        now: 10,
      }),
    ).rejects.toThrow('invalid ENS gateway secret')
    const [row] = await db
      .select({ resolutionCounter: ensNames.resolutionCounter })
      .from(ensNames)
      .where(eq(ensNames.id, ensNameId))
    expect(row?.resolutionCounter).toBe(0)
  })
})
