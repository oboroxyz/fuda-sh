import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { cards, challenges, issuers, logoUploads, members, sessions } from '../src/db/schema.ts'
import type { Bindings } from '../src/env.ts'
import { LOGO_SIDE } from '../src/media/logo.ts'
import { appWith, fakeChain, testEnv } from './env.ts'
import { configuredEnv, NOW, ROOT, seedRoot } from './fixtures.ts'
import { CARD_INPUT, getJson, postJson, signIn } from './operator.ts'

type App = ReturnType<typeof appWith>

// Only the signature and IHDR are read, so a header-accurate stub is a
// faithful stand-in for a real export from the dashboard's canvas.
const png = (side: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(new ArrayBuffer(64))
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(bytes.buffer)
  view.setUint32(12, 0x49_48_44_52)
  view.setUint32(16, side)
  view.setUint32(20, side)
  return bytes
}

const logoForm = (over: Partial<Record<string, number>> = {}): FormData => {
  const form = new FormData()
  for (const [variant, side] of Object.entries(LOGO_SIDE)) {
    const use = over[variant] ?? side
    if (use > 0) {
      form.set(variant, new Blob([png(use)], { type: 'image/png' }), `${variant}.png`)
    }
  }
  return form
}

const upload = async (app: App, bindings: Bindings, token: string, form: FormData): Promise<Response> =>
  await app.request(
    '/issuers/logo',
    { body: form, headers: { authorization: `Bearer ${token}` }, method: 'POST' },
    bindings,
  )

const mediaEnv = (overrides: Partial<Bindings> = {}): Bindings =>
  testEnv({ API_BASE_URL: 'https://api.test', PUBLIC_BASE_URL: 'https://fuda.test', ...overrides })

describe('venue logo upload', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(members)
    await db.delete(sessions)
    await db.delete(challenges)
    await db.delete(logoUploads)
    await db.delete(cards)
    await db.delete(issuers)
  })

  it('stages a complete set and reports when it expires', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, mediaEnv())
    const res = await upload(app, mediaEnv(), token, logoForm())
    expect(res.status).toBe(201)
    const body = await res.json<{ expiresAt: number; logoUploadId: string }>()
    expect(body.expiresAt).toBe(NOW + 15 * 60)
    expect(body.logoUploadId).toMatch(/^[0-9a-f-]{36}$/u)
  })

  it('refuses a set that is incomplete or wrongly sized, writing nothing', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, mediaEnv())
    const missing = await upload(app, mediaEnv(), token, logoForm({ logo2x: 0 }))
    const wrong = await upload(app, mediaEnv(), token, logoForm({ master: 512 }))
    expect(missing.status).toBe(400)
    await expect(wrong.json()).resolves.toStrictEqual({ error: 'bad_upload' })
    const staged = await getDb({ DB: env.DB }).select().from(logoUploads)
    expect(staged).toStrictEqual([])
  })

  it('answers 501 without the bucket and 401 without a session', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, mediaEnv())
    const unconfigured = await upload(app, mediaEnv({ MEDIA_BUCKET: undefined }), token, logoForm())
    expect(unconfigured.status).toBe(501)
    await expect(unconfigured.json()).resolves.toStrictEqual({ error: 'media_not_configured' })
    const anonymous = await app.request('/issuers/logo', { body: logoForm(), method: 'POST' }, mediaEnv())
    expect(anonymous.status).toBe(401)
  })

  it('binds a staged logo to the venue it was created with', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, mediaEnv())
    const stagedRes = await upload(app, mediaEnv(), token, logoForm())
    const staged = await stagedRes.json<{ logoUploadId: string }>()
    const created = await postJson(
      app,
      mediaEnv(),
      '/issuers',
      { ...CARD_INPUT, logoUploadId: staged.logoUploadId },
      token,
    )
    expect(created.status).toBe(201)
    const row = await getDb({ DB: env.DB }).select().from(issuers).get()
    expect(row?.logoPrefix).toMatch(/^logos\/[0-9a-f-]{36}$/u)
  })

  it('spends a staged upload once', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, mediaEnv())
    const stagedRes = await upload(app, mediaEnv(), token, logoForm())
    const staged = await stagedRes.json<{ logoUploadId: string }>()
    await postJson(app, mediaEnv(), '/issuers', { ...CARD_INPUT, logoUploadId: staged.logoUploadId }, token)
    const replay = await postJson(app, mediaEnv(), '/issuers/logo/commit', staged, token)
    expect(replay.status).toBe(400)
    await expect(replay.json()).resolves.toStrictEqual({ error: 'upload_not_found' })
  })

  it('replaces the logo of an existing venue with a fresh prefix', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const { token } = await signIn(app, mediaEnv())
    await postJson(app, mediaEnv(), '/issuers', CARD_INPUT, token)
    const stagedRes = await upload(app, mediaEnv(), token, logoForm())
    const staged = await stagedRes.json<{ logoUploadId: string }>()
    const committed = await postJson(app, mediaEnv(), '/issuers/logo/commit', staged, token)
    expect(committed.status).toBe(200)
    const db = getDb({ DB: env.DB })
    const row = await db.select().from(issuers).where(eq(issuers.handle, 'wassie-coffee')).get()
    expect(row?.logoPrefix).toMatch(/^logos\/[0-9a-f-]{36}$/u)
  })
})

describe('serving a venue logo', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(sessions)
    await db.delete(challenges)
    await db.delete(logoUploads)
    await db.delete(cards)
    await db.delete(issuers)
  })

  const branded = async (): Promise<{ app: App; bindings: Bindings }> => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = mediaEnv()
    const { token } = await signIn(app, bindings)
    const stagedRes = await upload(app, bindings, token, logoForm())
    const staged = await stagedRes.json<{ logoUploadId: string }>()
    await postJson(app, bindings, '/issuers', { ...CARD_INPUT, logoUploadId: staged.logoUploadId }, token)
    return { app, bindings }
  }

  it('serves the master with an ETag and a short life for an unversioned link', async () => {
    const { app, bindings } = await branded()
    const res = await getJson(app, bindings, '/assets/wassie-coffee/logo/master')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    // Unversioned: a link printed before a logo change points here too, so it
    // must not be cached for a year.
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(res.headers.get('etag')).not.toBeNull()
  })

  it('answers 304 for a matching ETag', async () => {
    const { app, bindings } = await branded()
    const first = await getJson(app, bindings, '/assets/wassie-coffee/logo/master')
    const etag = first.headers.get('etag') ?? ''
    const again = await app.request(
      '/assets/wassie-coffee/logo/master',
      { headers: { 'if-none-match': etag } },
      bindings,
    )
    expect(again.status).toBe(304)
  })

  it('refuses an unknown variant, an unknown venue and a venue with no logo', async () => {
    const { app, bindings } = await branded()
    const variant = await getJson(app, bindings, '/assets/wassie-coffee/logo/original')
    const venue = await getJson(app, bindings, '/assets/nobody/logo/master')
    expect(variant.status).toBe(404)
    expect(venue.status).toBe(404)
    await getDb({ DB: env.DB }).update(issuers).set({ logoPrefix: null })
    const unbranded = await getJson(app, bindings, '/assets/wassie-coffee/logo/master')
    expect(unbranded.status).toBe(404)
  })
})

describe('a branded pass', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(members)
    await db.delete(sessions)
    await db.delete(challenges)
    await db.delete(logoUploads)
    await db.delete(cards)
    await db.delete(issuers)
  })

  const claimed = async (): Promise<{ app: App; bindings: Bindings; uid: string }> => {
    const chain = fakeChain({ signer: ROOT })
    const del = seedRoot(chain)
    const app = appWith({ chain, now: () => NOW })
    const bindings = configuredEnv(del, {
      API_BASE_URL: 'https://api.test',
      PUBLIC_BASE_URL: 'https://fuda.test',
    })
    const { token } = await signIn(app, bindings)
    const stagedRes = await upload(app, bindings, token, logoForm())
    const staged = await stagedRes.json<{ logoUploadId: string }>()
    await postJson(app, bindings, '/issuers', { ...CARD_INPUT, logoUploadId: staged.logoUploadId }, token)
    const issued = await app.request(
      '/issuers/wassie-coffee/stamp/issue',
      { headers: { 'CF-Connecting-IP': '203.0.113.70' }, method: 'POST' },
      bindings,
    )
    const body = await issued.json<{ uid: string }>()
    return { app, bindings, uid: body.uid }
  }

  it('points the web pass at the venue mark', async () => {
    const { app, bindings, uid } = await claimed()
    const page = await app.request(`/pass/${uid}`, {}, bindings)
    const html = await page.text()
    expect(html).toContain('https://api.test/assets/wassie-coffee/logo/master')
  })

  it('leaves an unbranded venue without a logo url', async () => {
    const { app, bindings, uid } = await claimed()
    await getDb({ DB: env.DB }).update(issuers).set({ logoPrefix: null })
    const page = await app.request(`/pass/${uid}`, {}, bindings)
    const html = await page.text()
    expect(html).not.toContain('/assets/wassie-coffee/logo/master')
  })
})

describe('the versioned logo url', () => {
  beforeEach(async () => {
    const db = getDb({ DB: env.DB })
    await db.delete(sessions)
    await db.delete(challenges)
    await db.delete(logoUploads)
    await db.delete(cards)
    await db.delete(issuers)
  })

  it('names the stored version, so a replacement is a different url', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = mediaEnv()
    const { token } = await signIn(app, bindings)
    const firstRes = await upload(app, bindings, token, logoForm())
    const first = await firstRes.json<{ logoUploadId: string }>()
    const createdRes = await postJson(
      app,
      bindings,
      '/issuers',
      { ...CARD_INPUT, logoUploadId: first.logoUploadId },
      token,
    )
    const created = await createdRes.json<{ issuer: { logoUrl: string } }>()
    expect(created.issuer.logoUrl).toMatch(/\/assets\/wassie-coffee\/logo\/master\?v=[0-9a-f-]{36}$/u)
    const secondRes = await upload(app, bindings, token, logoForm())
    const second = await secondRes.json<{ logoUploadId: string }>()
    const changedRes = await postJson(app, bindings, '/issuers/logo/commit', second, token)
    const changed = await changedRes.json<{ issuer: { logoUrl: string } }>()
    expect(changed.issuer.logoUrl).not.toBe(created.issuer.logoUrl)
  })

  it('caches forever only when the request names the current version', async () => {
    const app = appWith({ chain: fakeChain(), now: () => NOW })
    const bindings = mediaEnv()
    const { token } = await signIn(app, bindings)
    const stagedRes = await upload(app, bindings, token, logoForm())
    const staged = await stagedRes.json<{ logoUploadId: string }>()
    const createdRes = await postJson(
      app,
      bindings,
      '/issuers',
      { ...CARD_INPUT, logoUploadId: staged.logoUploadId },
      token,
    )
    const created = await createdRes.json<{ issuer: { logoUrl: string } }>()
    const versioned = await getJson(
      app,
      bindings,
      new URL(created.issuer.logoUrl).pathname + new URL(created.issuer.logoUrl).search,
    )
    const bare = await getJson(app, bindings, '/assets/wassie-coffee/logo/master')
    const stale = await getJson(app, bindings, '/assets/wassie-coffee/logo/master?v=old')
    expect(versioned.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(bare.headers.get('cache-control')).toBe('public, max-age=60')
    expect(stale.headers.get('cache-control')).toBe('public, max-age=60')
  })
})
