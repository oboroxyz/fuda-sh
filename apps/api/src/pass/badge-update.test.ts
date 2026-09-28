import { env } from 'cloudflare:test'
import type { Context } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client.ts'
import { badges } from '../db/schema.ts'
import type { AppEnv, Bindings } from '../env.ts'
import { scheduleBadgePassUpdate } from './badge-update.ts'

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

describe(scheduleBadgePassUpdate, () => {
  beforeEach(async () => {
    await db.delete(badges)
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
  })

  afterEach(() => vi.unstubAllGlobals())

  it('patches the saved object with the stored badges, not any earlier claim', async () => {
    const requests: Request[] = []
    // oxlint-disable-next-line require-await -- Fetch-compatible test double
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      if (request.url.includes('oauth2.googleapis.com')) {
        return Response.json({ access_token: 'access' })
      }
      if (request.method === 'GET') {
        return Response.json({ textModulesData: [{ body: 'VIP', header: 'Tier', id: 'tier' }] })
      }
      return Response.json({})
    })
    const kept: Promise<unknown>[] = []
    scheduleBadgePassUpdate(context(kept, await googleBindings()), UID)
    expect(kept).toHaveLength(1)
    await expect(kept[0]).resolves.toBeUndefined()
    const patch = requests.find(({ method }) => method === 'PATCH')
    expect(patch).toBeDefined()
    await expect(patch?.json()).resolves.toStrictEqual({
      textModulesData: [
        { body: 'VIP', header: 'Tier', id: 'tier' },
        { body: 'Verified human', header: 'Badge', id: 'fuda-badge-human' },
      ],
    })
  })

  it('isolates Google failures from the badge route result', async () => {
    // oxlint-disable-next-line require-await -- Fetch-compatible failure double
    vi.stubGlobal('fetch', async () => new Response(null, { status: 503 }))
    const kept: Promise<unknown>[] = []
    scheduleBadgePassUpdate(context(kept, await googleBindings()), UID)
    await expect(kept[0]).resolves.toBeUndefined()
  })

  it('does nothing when Google is not configured', () => {
    const kept: Promise<unknown>[] = []
    scheduleBadgePassUpdate(context(kept, {}), UID)
    expect(kept).toHaveLength(0)
  })
})
