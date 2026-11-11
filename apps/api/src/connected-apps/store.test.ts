import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { assert, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client.ts'
import { connectedAppRedirects, connectedApps, issuers, oauthCodes, oauthTokens } from '../db/schema.ts'
import {
  listApps,
  listGrants,
  mintCode,
  pkceChallenge,
  redeemCode,
  registerApp,
  resolveAccessToken,
  revokeGrant,
} from './store.ts'

const NOW = 1000
const OWNER = '0x123'
const REDIRECT = 'https://app.example/callback'
const VERIFIER = 'v'.repeat(43)
const db = getDb({ DB: env.DB })

const issue = async () => {
  const code = await mintCode(db, {
    address: OWNER,
    clientId: 'app',
    codeChallenge: await pkceChallenge(VERIFIER),
    issuerId: 'issuer',
    now: NOW,
    redirectUri: REDIRECT,
    resource: null,
    scope: ['cards:read'],
  })
  return {
    clientId: 'app',
    code,
    codeVerifier: VERIFIER,
    now: NOW,
    redirectUri: REDIRECT,
    resource: undefined,
  }
}

describe('connected app state', () => {
  beforeEach(async () => {
    await db.delete(oauthTokens)
    await db.delete(oauthCodes)
    await db.delete(connectedAppRedirects)
    await db.delete(connectedApps)
    await db.delete(issuers)
    await db.insert(issuers).values({
      brandColor: '#000000',
      createdAt: 0,
      handle: 'shop',
      id: 'issuer',
      name: 'Shop',
      operatorAddress: OWNER,
    })
    await db.insert(connectedApps).values({ clientId: 'app', createdAt: 0, name: 'App', ownerAddress: OWNER })
  })

  it('prevents issuance when a replay lands after spending the code but before inserting the token', async () => {
    const request = await issue()
    const batch = db.batch.bind(db)
    const interleave = vi.spyOn(db, 'batch').mockImplementationOnce(async (queries) => {
      const spent = await db.select().from(oauthCodes).get()
      expect(spent?.usedAt).toBe(NOW)
      await expect(db.select().from(oauthTokens)).resolves.toStrictEqual([])
      await expect(redeemCode(getDb({ DB: env.DB }), request)).resolves.toBeNull()
      return await batch(queries)
    })
    try {
      await expect(redeemCode(db, request)).resolves.toBeNull()
      await expect(listGrants(db, OWNER, NOW, 'https://api.example')).resolves.toStrictEqual([])
      await expect(db.select().from(oauthTokens)).resolves.toStrictEqual([])
    } finally {
      interleave.mockRestore()
    }
  })

  it('revokes an already issued token when the code is replayed', async () => {
    const request = await issue()
    const token = await redeemCode(db, request)
    assert(token !== null)
    await expect(redeemCode(db, request)).resolves.toBeNull()
    await expect(resolveAccessToken(db, token.accessToken, NOW)).resolves.toBeNull()
  })

  it.each(['owner change', 'expiry', 'revocation'] as const)(
    'uses the same live-grant rules after %s',
    async (endedBy) => {
      const token = await redeemCode(db, await issue())
      assert(token !== null)
      const grant = await resolveAccessToken(db, token.accessToken, NOW)
      assert(grant !== null)
      await expect(listGrants(db, OWNER, NOW, 'https://api.example')).resolves.toHaveLength(1)
      let now = NOW
      if (endedBy === 'owner change') {
        await db.update(issuers).set({ operatorAddress: '0x456' }).where(eq(issuers.id, 'issuer'))
      } else if (endedBy === 'expiry') {
        now += 30 * 24 * 60 * 60
      } else {
        await revokeGrant(db, OWNER, grant.id, now)
      }
      await expect(resolveAccessToken(db, token.accessToken, now)).resolves.toBeNull()
      await expect(listGrants(db, OWNER, now, 'https://api.example')).resolves.toStrictEqual([])
      await expect(revokeGrant(db, OWNER, grant.id, now)).resolves.toBe(false)
    },
  )

  it('admits only one concurrent registration at the 20-app cap and keeps its redirects', async () => {
    await db.insert(connectedApps).values(
      Array.from({ length: 18 }, (_, i) => ({
        clientId: `app_${i}`,
        createdAt: 0,
        name: 'App',
        ownerAddress: OWNER,
      })),
    )
    const results = await Promise.all([
      registerApp(db, OWNER, { name: 'First', redirectUris: [REDIRECT] }, NOW),
      registerApp(getDb({ DB: env.DB }), OWNER, { name: 'Second', redirectUris: [REDIRECT] }, NOW),
    ])
    expect(results.filter((result) => result !== null)).toHaveLength(1)
    expect(results.filter((result) => result === null)).toHaveLength(1)
    await expect(listApps(db, OWNER)).resolves.toHaveLength(20)
    const winner = results.find((result) => result !== null)
    await expect(db.select().from(connectedAppRedirects)).resolves.toMatchObject([
      { clientId: winner?.clientId, redirectUri: REDIRECT },
    ])
    await expect(
      registerApp(db, 'another-owner', { name: 'Other', redirectUris: [REDIRECT] }, NOW),
    ).resolves.not.toBeNull()
  })
})
