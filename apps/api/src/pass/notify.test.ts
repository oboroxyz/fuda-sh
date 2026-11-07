import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client.ts'
import { badges, cards, cardStampSettings, issuers, members } from '../db/schema.ts'
import type { AppEnv, Bindings } from '../env.ts'
import { notifyPassChanged } from './notify.ts'

const UID = `0x${'ab'.repeat(32)}` as const
const db = getDb({ DB: env.DB })

const pem = async (): Promise<string> => {
  const pair = await crypto.subtle.generateKey(
    {
      hash: 'SHA-256',
      modulusLength: 2048,
      name: 'RSASSA-PKCS1-v1_5',
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify'],
  )
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCodePoint(...der))}\n-----END PRIVATE KEY-----`
}

const context = (kept: Promise<unknown>[], bindings: Partial<Bindings>): Context<AppEnv> =>
  ({
    env: bindings,
    executionCtx: { waitUntil: (promise: Promise<unknown>) => kept.push(promise) },
    get: (key: string) => (key === 'db' ? db : () => 1_757_000_000),
  }) as unknown as Context<AppEnv>

const googleBindings = async (): Promise<Partial<Bindings>> => ({
  GOOGLE_CLASS_ID: 'class',
  GOOGLE_ISSUER_ID: '338',
  GOOGLE_SA_EMAIL: 'sa@example.com',
  GOOGLE_SA_KEY_PEM: await pem(),
})

describe('notifying Google Wallet of a changed pass', () => {
  beforeEach(async () => {
    await db.delete(badges)
    await db.delete(cardStampSettings)
    await db.delete(members)
    await db.delete(cards)
    await db.delete(issuers)
    await db.insert(issuers).values({
      brandColor: '#112233',
      createdAt: 1,
      handle: 'coffee',
      id: 'venue',
      name: 'Coffee',
      operatorAddress: `0x${'11'.repeat(20)}`,
    })
    await db.insert(cards).values({
      category: 'membership',
      createdAt: 1,
      id: 'card',
      issuerId: 'venue',
      slug: 'coffee',
      title: 'Coffee',
    })
    await db.insert(members).values({
      attestationUid: UID,
      cardId: 'card',
      createdAt: 1,
      issuerId: 'venue',
      level: 'bearer',
      memberId: 'member',
    })
    await db.insert(cardStampSettings).values({ cardId: 'card', dailyLimit: 2, enabled: true, goal: 10 })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('patches the latest durable stamp summary, even one that changed during the patch', async () => {
    const requests: Request[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      if (new URL(request.url).host === 'oauth2.googleapis.com') {
        return Response.json({ access_token: 'access' })
      }
      if (request.method === 'GET') {
        return Response.json({ textModulesData: [{ body: 'VIP', header: 'Tier', id: 'tier' }] })
      }
      if (requests.filter(({ method }) => method === 'PATCH').length === 1) {
        await db.update(cardStampSettings).set({ goal: 12 }).where(eq(cardStampSettings.cardId, 'card'))
      }
      return Response.json({})
    })
    const kept: Promise<unknown>[] = []
    notifyPassChanged(context(kept, await googleBindings()), UID)
    expect(kept).toHaveLength(1)
    await kept[0]
    const patches = requests.filter(({ method }) => method === 'PATCH')
    expect(JSON.stringify(await patches[1]?.json())).toContain('0 / 12')
  })

  it('patches the stored badges, not any earlier claim', async () => {
    await db.insert(badges).values({
      credential: 'orb',
      expiresAt: null,
      kind: 'human',
      scope: 'app_test:action',
      subjectKey: '0xdead',
      uid: UID,
      verifiedAt: 1_757_000_000,
      verifier: 'world',
    })
    const bodies: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (new URL(request.url).host === 'oauth2.googleapis.com') {
        return Response.json({ access_token: 'access' })
      }
      if (request.method === 'PATCH') {
        bodies.push(await request.text())
      }
      return Response.json({ textModulesData: [] })
    })
    const kept: Promise<unknown>[] = []
    notifyPassChanged(context(kept, await googleBindings()), UID)
    await kept[0]
    expect(bodies.at(-1)).toContain('Verified human')
  })

  it('isolates a Google failure from the action it follows', async () => {
    // oxlint-disable-next-line require-await -- Fetch-compatible failure double
    vi.stubGlobal('fetch', async () => new Response(null, { status: 503 }))
    const kept: Promise<unknown>[] = []
    notifyPassChanged(context(kept, await googleBindings()), UID)
    await expect(kept[0]).resolves.toBeUndefined()
  })

  it('schedules nothing when no wallet platform is configured', () => {
    const kept: Promise<unknown>[] = []
    notifyPassChanged(context(kept, {}), UID)
    expect(kept).toHaveLength(0)
  })
})
