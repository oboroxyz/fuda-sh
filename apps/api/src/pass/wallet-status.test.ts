import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client.ts'
import { members, offchainAttestations, slots } from '../db/schema.ts'
import { walletValidity } from './wallet-status.ts'

const UID = `0x${'cd'.repeat(32)}` as const
const db = getDb({ DB: env.DB })

describe(walletValidity, () => {
  it.each([
    ['active', 1, 0, 0, false, 'active'],
    ['revoked', 0, 200, 50, true, 'revoked'],
    ['active', 1, 200, 300, false, 'not_yet_valid'],
    ['active', 1, 0, 50, false, 'expired'],
    ['active', 0, 0, 0, true, 'consumed'],
    ['active', 1, 0, 0, true, 'active'],
    ['active', null, null, null, false, 'unknown'],
  ] as const)(
    'derives %s %s %s %s %s as %s',
    async (status, usageModel, validFrom, validUntil, consumed, expected) => {
      await db.delete(slots)
      await db.delete(offchainAttestations)
      await db.delete(members)
      const [row] = await db
        .insert(members)
        .values({
          attestationUid: UID,
          createdAt: 1,
          level: 'bearer',
          status,
          usageModel,
          validFrom,
          validUntil,
        })
        .returning()
      if (row === undefined) {
        throw new Error('member insert returned no row')
      }
      if (consumed) {
        await db.insert(slots).values({ consumedAt: 1, slot: 'default', uid: UID })
      }
      await expect(walletValidity(db, UID, row, 100)).resolves.toStrictEqual({
        status: expected,
        validFrom,
        validUntil,
      })
    },
  )

  it('uses the earlier signed EAS expiry for status and wallet dates', async () => {
    await db.delete(slots)
    await db.delete(offchainAttestations)
    await db.delete(members)
    const [row] = await db
      .insert(members)
      .values({
        attestationUid: UID,
        createdAt: 1,
        level: 'bearer',
        usageModel: 1,
        validFrom: 0,
        validUntil: 200,
      })
      .returning()
    if (row === undefined) {
      throw new Error('member insert returned no row')
    }
    await db.insert(offchainAttestations).values({
      createdAt: 1,
      signed: JSON.stringify({
        domain: { chainId: 84_532, name: 'EAS Attestation', verifyingContract: UID, version: '1' },
        message: {
          data: '0x',
          expirationTime: '50',
          recipient: UID,
          refUID: UID,
          revocable: true,
          salt: UID,
          schema: UID,
          time: '1',
          version: 2,
        },
        signature: '0x',
        uid: UID,
      }),
      uid: UID,
    })
    await expect(walletValidity(db, UID, row, 100)).resolves.toStrictEqual({
      status: 'expired',
      validFrom: 0,
      validUntil: 50,
    })
  })
})
