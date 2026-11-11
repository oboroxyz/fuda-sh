import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { redeemCode } from '../connected-apps/store.ts'
import { getDb } from '../db/client.ts'
import { connectedApps, issuers, oauthTokens, passkeyChallenges, rateLimits, sessions } from '../db/schema.ts'
import { purgeExpiredAuthRows } from './expired-rows.ts'
import { hashToken } from './session.ts'

const NOW = 2_000_000
const db = getDb({ DB: env.DB })

describe('expired auth rows', () => {
  beforeEach(async () => {
    await db.delete(oauthTokens)
    await db.delete(connectedApps)
    await db.delete(issuers)
    await db.delete(passkeyChallenges)
    await db.delete(sessions)
    await db.delete(rateLimits)
  })

  it('deletes expired challenges, sessions and ended windows, keeping live rows at the boundary', async () => {
    await db.insert(passkeyChallenges).values([
      { challenge: 'expired', createdAt: NOW - 300, purpose: 'login' },
      { challenge: 'live', createdAt: NOW - 299, purpose: 'login' },
    ])
    await db.insert(sessions).values([
      { address: '', createdAt: 0, expiresAt: NOW, tokenHash: 'expired' },
      { address: '', createdAt: 0, expiresAt: NOW + 1, tokenHash: 'live' },
    ])
    await db.insert(rateLimits).values([
      { count: 1, ip: 'same-ip', windowStart: NOW - 3600 },
      { count: 1, ip: 'same-ip', windowStart: NOW - 3599 },
    ])

    await expect(purgeExpiredAuthRows(env.DB, NOW)).resolves.toBe(3)
    await expect(db.select().from(passkeyChallenges)).resolves.toMatchObject([{ challenge: 'live' }])
    await expect(db.select().from(sessions)).resolves.toMatchObject([{ tokenHash: 'live' }])
    await expect(db.select().from(rateLimits)).resolves.toMatchObject([{ windowStart: NOW - 3599 }])
    await expect(purgeExpiredAuthRows(env.DB, NOW)).resolves.toBe(0)
  })

  it('retains dead tokens for 24 hours and preserves replay revocation for live tokens', async () => {
    await db.insert(issuers).values({
      brandColor: '#000000',
      createdAt: 0,
      handle: 'sweep',
      id: 'issuer',
      name: 'Sweep',
      operatorAddress: '0x123',
    })
    await db
      .insert(connectedApps)
      .values({ clientId: 'app', createdAt: 0, name: 'App', ownerAddress: '0x123' })
    const codeHash = await hashToken('spent-code')
    const tokens = [
      { expiresAt: NOW - 86_400, id: 'expired', revokedAt: null },
      { expiresAt: NOW + 100, id: 'revoked', revokedAt: NOW - 86_400 },
      { expiresAt: NOW - 86_399, id: 'recent-expiry', revokedAt: null },
      { expiresAt: NOW + 100, id: 'recent-revocation', revokedAt: NOW - 86_399 },
      { expiresAt: NOW + 100, id: 'live', revokedAt: null },
    ]
    await db.insert(oauthTokens).values(
      tokens.map((token) => ({
        ...token,
        address: '0x123',
        clientId: 'app',
        codeHash,
        createdAt: NOW - 100_000,
        issuerId: 'issuer',
        scope: 'cards:read',
        tokenHash: token.id,
      })),
    )

    await expect(purgeExpiredAuthRows(env.DB, NOW)).resolves.toBe(2)
    const retained = await db.select().from(oauthTokens)
    expect(retained.map(({ id }) => id).toSorted()).toStrictEqual([
      'live',
      'recent-expiry',
      'recent-revocation',
    ])
    // A replay still revokes the live token when the original code row is already gone.
    await expect(
      redeemCode(db, {
        clientId: 'app',
        code: 'spent-code',
        codeVerifier: 'v'.repeat(43),
        now: NOW,
        redirectUri: 'https://example.test',
        resource: undefined,
      }),
    ).resolves.toBeNull()
    const replayed = await db.select().from(oauthTokens)
    expect(replayed.find(({ id }) => id === 'live')?.revokedAt).toBe(NOW)
  })

  it('bounds a run and drains the remaining backlog on the next run', async () => {
    const statements = Array.from({ length: 805 }, (_, index) =>
      env.DB.prepare(
        "INSERT INTO passkey_challenges (challenge, created_at, purpose) VALUES (?1, 0, 'login')",
      ).bind(`old-${index}`),
    )
    await env.DB.batch(statements)
    await expect(purgeExpiredAuthRows(env.DB, NOW)).resolves.toBe(800)
    await expect(
      env.DB.prepare('SELECT COUNT(*) AS count FROM passkey_challenges').first('count'),
    ).resolves.toBe(5)
    await expect(purgeExpiredAuthRows(env.DB, NOW)).resolves.toBe(5)
  })
})
