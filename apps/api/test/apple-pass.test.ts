import { env } from 'cloudflare:test'
import * as pkijs from 'pkijs'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { saveBadge } from '../src/badges/store.ts'
import { getDb } from '../src/db/client.ts'
import { cards, issuers, members } from '../src/db/schema.ts'
import type { Bindings } from '../src/env.ts'
import { testCert } from './apple-cert.ts'
import { appWith, fakeChain } from './env.ts'
import { configuredEnv, HOLDER, NOW, seedRight, seedRoot } from './fixtures.ts'

const db = () => getDb({ DB: env.DB })

const insertMember = async (uid: Hex, tier = 2): Promise<void> => {
  await db()
    .insert(members)
    .values({ attestationUid: uid, createdAt: NOW, holder: HOLDER, level: 'bearer', memberId: 'alice', tier })
}

// The self-signed test certificate stands in for both the Pass Type ID
// certificate and the WWDR intermediate: the route only has to parse them and
// sign with the key, and the test verifies the result against the same cert.
const appleEnv = async (del: Hex): Promise<Bindings> => {
  const cert = await testCert()
  return configuredEnv(del, {
    APPLE_CERT_PEM: cert.certPem,
    APPLE_KEY_PEM: cert.keyPem,
    APPLE_PASS_TYPE_ID: 'pass.sh.fuda.membership',
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_WWDR_PEM: cert.certPem,
  })
}

interface ZipEntry {
  name: string
  data: Uint8Array<ArrayBuffer>
}

interface InstalledPass {
  passTypeIdentifier: string
  teamIdentifier: string
  serialNumber: string
  barcodes: { message: string }[]
  storeCard: {
    headerFields?: { key: string; value: string }[]
    primaryFields: { value: string }[]
    auxiliaryFields?: { key: string; label?: string; value: string }[]
  }
}

// A copy with its own exact-sized buffer: WebCrypto and pkijs both reject the
// `ArrayBufferLike` a subarray of the response body carries.
const owned = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(bytes.length))
  out.set(bytes)
  return out
}

// A reader for the archive the builder writes: walks the local file headers,
// which is what an unzip tool does before consulting the central directory.
const readZip = (zip: Uint8Array): ZipEntry[] => {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const entries: ZipEntry[] = []
  let at = 0
  while (view.getUint32(at, true) === 0x04_03_4b_50) {
    const size = view.getUint32(at + 18, true)
    const nameLength = view.getUint16(at + 26, true)
    const start = at + 30 + nameLength
    entries.push({
      data: owned(zip.slice(start, start + size)),
      name: new TextDecoder().decode(zip.slice(at + 30, start)),
    })
    at = start + size
  }
  return entries
}

const centralDirectoryCount = (zip: Uint8Array): number => {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  return view.getUint16(zip.length - 22 + 10, true)
}

const fetchPkpass = async (bindings: Bindings, uid: Hex): Promise<Response> =>
  await appWith({ chain: fakeChain(), now: () => NOW }).request(`/pass/${uid}/apple.pkpass`, {}, bindings)

const byName = (entries: ZipEntry[], name: string): Uint8Array<ArrayBuffer> =>
  entries.find((e) => e.name === name)?.data ?? new Uint8Array(new ArrayBuffer(0))

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

describe('GET /pass/:uid/apple.pkpass', () => {
  beforeEach(async () => {
    await db().delete(members)
  })

  it('answers 200 with the pkpass content type and an attachment name', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { tier: 2 })
    await insertMember(uid)
    const res = await fetchPkpass(await appleEnv(del), uid)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/vnd.apple.pkpass')
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="fuda-${uid.slice(0, 10)}.pkpass"`,
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('is a ZIP of exactly pass.json, icon.png, manifest.json and signature', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    const res = await fetchPkpass(await appleEnv(del), uid)
    const zip = new Uint8Array(await res.arrayBuffer())
    expect(zip.slice(0, 4)).toStrictEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
    const entries = readZip(zip)
    expect(entries.map((e) => e.name)).toStrictEqual(['pass.json', 'icon.png', 'manifest.json', 'signature'])
    expect(centralDirectoryCount(zip)).toBe(4)
  })

  it('carries a pass.json naming the configured pass type, team and uid', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { tier: 2 })
    await insertMember(uid)
    const res = await fetchPkpass(await appleEnv(del), uid)
    const entries = readZip(new Uint8Array(await res.arrayBuffer()))
    const pass = JSON.parse(new TextDecoder().decode(byName(entries, 'pass.json'))) as InstalledPass
    expect(pass.passTypeIdentifier).toBe('pass.sh.fuda.membership')
    expect(pass.teamIdentifier).toBe('TEAM123456')
    expect(pass.serialNumber).toBe(uid)
    expect(pass.barcodes[0]?.message).toBe(`fuda:v1:${uid}`)
    expect(pass.storeCard.primaryFields[0]?.value).toBe('VIP')
  })

  // Wallet can only announce a change to a pass it already holds, so the download is what
  // shows a badge saved first.
  it('carries a badge saved before the pass was downloaded', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del, { tier: 2 })
    await insertMember(uid)
    await saveBadge(db(), {
      credential: 'proof_of_human',
      expiresAt: null,
      kind: 'human',
      scope: 'rp_test:fuda-human',
      subjectKey: `0x${'0'.repeat(60)}dead`,
      uid,
      verifiedAt: NOW,
      verifier: 'world',
    })
    const res = await fetchPkpass(await appleEnv(del), uid)
    const entries = readZip(new Uint8Array(await res.arrayBuffer()))
    const body = new TextDecoder().decode(byName(entries, 'pass.json'))
    const pass = JSON.parse(body) as InstalledPass
    expect(pass.storeCard.auxiliaryFields).toStrictEqual([
      { changeMessage: 'Badge: %@', key: 'badge-human', label: 'BADGE', value: 'Verified human' },
    ])
    // Only the fact of the badge travels: no verifier name, no scope, no
    // subject key, no verification time.
    expect(body).not.toContain('world')
    expect(body).not.toContain('dead')
  })

  it('hashes pass.json and icon.png into the manifest, and nothing else', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    const res = await fetchPkpass(await appleEnv(del), uid)
    const entries = readZip(new Uint8Array(await res.arrayBuffer()))
    const manifest = JSON.parse(new TextDecoder().decode(byName(entries, 'manifest.json'))) as Record<
      string,
      string
    >
    expect(Object.keys(manifest)).toStrictEqual(['pass.json', 'icon.png'])
    const passDigest = await crypto.subtle.digest('SHA-1', byName(entries, 'pass.json'))
    const iconDigest = await crypto.subtle.digest('SHA-1', byName(entries, 'icon.png'))
    expect(manifest['pass.json']).toBe(hex(new Uint8Array(passDigest)))
    expect(manifest['icon.png']).toBe(hex(new Uint8Array(iconDigest)))
  })

  it('signs the manifest with a detached CMS that verifies against the certificate', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    const res = await fetchPkpass(await appleEnv(del), uid)
    const entries = readZip(new Uint8Array(await res.arrayBuffer()))
    const signature = byName(entries, 'signature')
    const info = pkijs.ContentInfo.fromBER(signature)
    const signed = new pkijs.SignedData({ schema: info.content })
    const manifest = byName(entries, 'manifest.json')
    const ok = await signed.verify({
      checkChain: false,
      data: manifest.buffer,
      signer: 0,
    })
    expect(ok).toBe(true)
  })

  it('is 501 when a required APPLE_* secret is missing', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    const full = await appleEnv(del)
    const partial: Bindings = { ...full, APPLE_WWDR_PEM: undefined }
    const res = await fetchPkpass(partial, uid)
    expect(res.status).toBe(501)
    await expect(res.json()).resolves.toStrictEqual({ error: 'apple_not_configured' })
  })

  // A bad secret is a configuration problem, not an internal defect.
  it('is 501, not 5xx, when the configured certificate cannot be parsed', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    await insertMember(uid)
    const broken: Bindings = { ...(await appleEnv(del)), APPLE_CERT_PEM: 'not a certificate' }
    const res = await fetchPkpass(broken, uid)
    expect(res.status).toBe(501)
    await expect(res.json()).resolves.toStrictEqual({ error: 'apple_not_configured' })
  })

  it('is 400 for a junk uid even when configured', async () => {
    const bindings = await appleEnv(seedRoot(fakeChain()))
    const junk = await appWith({ chain: fakeChain(), now: () => NOW }).request(
      '/pass/nope/apple.pkpass',
      {},
      bindings,
    )
    expect(junk.status).toBe(400)
  })

  it('embeds card artwork and moves the title only while all strip bytes are available', async () => {
    const chain = fakeChain()
    const del = seedRoot(chain)
    const uid = seedRight(chain, del)
    const bindings = await appleEnv(del)
    const prefix = `artwork/${crypto.randomUUID()}`
    await db().insert(issuers).values({
      brandColor: '#112233',
      createdAt: NOW,
      handle: 'art-cafe',
      id: 'art-issuer',
      name: 'Cafe',
      operatorAddress: HOLDER,
      tagline: '',
    })
    await db().insert(cards).values({
      artworkPrefix: prefix,
      category: 'membership',
      createdAt: NOW,
      id: 'art-card',
      issuerId: 'art-issuer',
      title: 'Coffee',
    })
    await db().insert(members).values({
      attestationUid: uid,
      cardId: 'art-card',
      createdAt: NOW,
      holder: HOLDER,
      issuerId: 'art-issuer',
      level: 'bearer',
      memberId: 'qj2yxphepdrka',
      tier: 1,
    })
    const bucket = bindings.MEDIA_BUCKET
    if (bucket === undefined) {
      throw new Error('Media bucket missing')
    }
    await Promise.all(
      ['strip1x', 'strip2x', 'strip3x'].map(
        async (variant) => await bucket.put(`${prefix}/${variant}.png`, new Uint8Array([1, 2, 3])),
      ),
    )
    const response = await fetchPkpass(bindings, uid)
    const entries = readZip(new Uint8Array(await response.arrayBuffer()))
    const json = await new Response(byName(entries, 'pass.json')).json<InstalledPass>()
    expect(
      entries.filter((entry) => entry.name.startsWith('strip')).map((entry) => entry.name),
    ).toStrictEqual(['strip.png', 'strip@2x.png', 'strip@3x.png'])
    expect(json.storeCard).toMatchObject({
      headerFields: [{ key: 'title', value: 'Coffee' }],
      primaryFields: [],
    })
    await bucket.delete(`${prefix}/strip2x.png`)
    const fallbackResponse = await fetchPkpass(bindings, uid)
    const fallback = readZip(new Uint8Array(await fallbackResponse.arrayBuffer()))
    const fallbackJson = await new Response(byName(fallback, 'pass.json')).json<InstalledPass>()
    expect(fallback.filter((entry) => entry.name.startsWith('strip'))).toStrictEqual([])
    expect(fallbackJson.storeCard.headerFields).toBeUndefined()
    expect(fallbackJson.storeCard.primaryFields).toStrictEqual([{ key: 'title', value: 'Coffee' }])
  })
})
