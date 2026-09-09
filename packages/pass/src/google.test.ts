import type { Hex } from '@fuda/sdk'
import { toQr } from '@fuda/sdk'
import { describe, expect, it } from 'vitest'

import { base64urlBytes } from './base64url.ts'
import type { GoogleConfig, GoogleJwtClaims, GooglePassInput } from './google.ts'
import {
  buildGenericObject,
  buildGoogleSaveUrl,
  googleAccessToken,
  GOOGLE_SAVE_BASE,
  googleConfigFrom,
  mergeStampModules,
  patchGoogleGenericObject,
} from './google.ts'

const UID: Hex = `0x${'ab'.repeat(32)}`
const INPUT: GooglePassInput = {
  holderShort: '0x1111…1111',
  qr: toQr(UID),
  tierLabel: 'VIP',
  uid: UID,
}
const ORIGINS = ['https://api.fuda.sh', 'https://dash.fuda.sh', 'https://app.fuda.sh']
const IAT = 1_757_000_000

interface Fixture {
  cfg: GoogleConfig
  publicKey: CryptoKey
}

// One 2048-bit RSA key pair for the whole file: generating it is the slowest
// thing here, so the promise is created once and awaited by each test.
const fixture: Promise<Fixture> = (async (): Promise<Fixture> => {
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
  const body = btoa(String.fromCodePoint(...der))
  return {
    cfg: {
      classId: '3388000000000000001.fuda-membership',
      issuerId: '3388000000000000001',
      saEmail: 'wallet@fuda.iam.gserviceaccount.com',
      // The escaped form a service-account JSON carries, on purpose.
      saKeyPem: String.raw`-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`,
    },
    publicKey: pair.publicKey,
  }
})()

const decode = (segment: string): string =>
  new TextDecoder().decode(
    Uint8Array.from(atob(segment.replaceAll('-', '+').replaceAll('_', '/')), (ch) => ch.codePointAt(0) ?? 0),
  )

const sign = async (): Promise<string[]> => {
  const { cfg } = await fixture
  const url = await buildGoogleSaveUrl(cfg, INPUT, ORIGINS, IAT)
  return url.slice(GOOGLE_SAVE_BASE.length).split('.')
}

describe(googleConfigFrom, () => {
  it('reads the four secrets into a config', () => {
    const out = googleConfigFrom({
      GOOGLE_CLASS_ID: 'c',
      GOOGLE_ISSUER_ID: 'i',
      GOOGLE_SA_EMAIL: 'e',
      GOOGLE_SA_KEY_PEM: 'p',
    })
    expect(out).toStrictEqual({ classId: 'c', issuerId: 'i', saEmail: 'e', saKeyPem: 'p' })
  })

  it('is null unless all four secrets are set and non-empty', () => {
    const full = { GOOGLE_CLASS_ID: 'c', GOOGLE_ISSUER_ID: 'i', GOOGLE_SA_EMAIL: 'e', GOOGLE_SA_KEY_PEM: 'p' }
    expect(googleConfigFrom({})).toBeNull()
    expect(googleConfigFrom({ ...full, GOOGLE_ISSUER_ID: undefined })).toBeNull()
    expect(googleConfigFrom({ ...full, GOOGLE_CLASS_ID: '' })).toBeNull()
    expect(googleConfigFrom({ ...full, GOOGLE_SA_EMAIL: '' })).toBeNull()
    expect(googleConfigFrom({ ...full, GOOGLE_SA_KEY_PEM: '' })).toBeNull()
  })
})

describe(buildGenericObject, () => {
  it('builds the documented object: issuer-scoped id, class, QR payload', () => {
    const obj = buildGenericObject({ classId: 'c', issuerId: '338', saEmail: 'e', saKeyPem: 'p' }, INPUT)
    expect(obj.id).toBe(`338.${UID.slice(2)}`)
    expect(obj.classId).toBe('c')
    expect(obj.state).toBe('ACTIVE')
    expect(obj.barcode).toStrictEqual({
      alternateText: UID.slice(0, 10),
      type: 'QR_CODE',
      value: `fuda:v1:${UID}`,
    })
  })

  it('shows the tier as the header and repeats tier and member as text modules', () => {
    const obj = buildGenericObject({ classId: 'c', issuerId: '338', saEmail: 'e', saKeyPem: 'p' }, INPUT)
    expect(obj.cardTitle.defaultValue.value).toBe('fuda membership')
    expect(obj.header.defaultValue.value).toBe('VIP')
    expect(obj.textModulesData).toStrictEqual([
      { body: 'VIP', header: 'Tier', id: 'tier' },
      { body: '0x1111…1111', header: 'Member', id: 'member' },
    ])
  })
})

describe(buildGoogleSaveUrl, () => {
  it('returns a save link carrying a three-segment RS256 JWT', async () => {
    const { cfg } = await fixture
    const url = await buildGoogleSaveUrl(cfg, INPUT, ORIGINS, IAT)
    expect(url.startsWith(GOOGLE_SAVE_BASE)).toBe(true)
    const parts = url.slice(GOOGLE_SAVE_BASE.length).split('.')
    expect(parts).toHaveLength(3)
    expect(JSON.parse(decode(parts[0] ?? ''))).toStrictEqual({ alg: 'RS256', typ: 'JWT' })
  })

  it('signs head.body with the service-account key', async () => {
    const { publicKey } = await fixture
    const [head, body, sig] = await sign()
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      Uint8Array.from(
        atob((sig ?? '').replaceAll('-', '+').replaceAll('_', '/')),
        (ch) => ch.codePointAt(0) ?? 0,
      ),
      new TextEncoder().encode(`${head}.${body}`),
    )
    expect(ok).toBe(true)
  })

  it('claims the savetowallet audience, the issuer and the allowed origins', async () => {
    const { cfg } = await fixture
    const [, body] = await sign()
    const claims = JSON.parse(decode(body ?? '')) as GoogleJwtClaims
    expect(claims.aud).toBe('google')
    expect(claims.typ).toBe('savetowallet')
    expect(claims.iss).toBe(cfg.saEmail)
    expect(claims.origins).toStrictEqual(ORIGINS)
    expect(claims.iat).toBe(IAT)
  })

  it('carries the pass object in the payload and never the private key', async () => {
    const { cfg } = await fixture
    const [, body] = await sign()
    const decoded = decode(body ?? '')
    const claims = JSON.parse(decoded) as GoogleJwtClaims
    expect(claims.payload.genericObjects).toHaveLength(1)
    expect(claims.payload.genericObjects[0]?.id).toBe(`${cfg.issuerId}.${UID.slice(2)}`)
    expect(claims.payload.genericObjects[0]?.barcode.value).toBe(`fuda:v1:${UID}`)
    expect(decoded).not.toContain('PRIVATE KEY')
  })
})

describe(base64urlBytes, () => {
  it('leaves no padding in the JWT segments', async () => {
    const parts = await sign()
    expect(parts.join('')).not.toContain('=')
  })
})

describe('branded generic object', () => {
  it('shows the venue, card title, member number and brand colour', () => {
    const obj = buildGenericObject(
      { classId: 'c', issuerId: 'i', saEmail: 'sa@example.com', saKeyPem: '' },
      {
        branding: {
          brandColor: '#6F4320',
          cardTitle: 'Membership Card',
          issuerName: 'Wassie Coffee',
          logoUrl: null,
          memberNumber: 'QJ2Y-XPHE-PDRKA',
          venue: null,
        },
        holderShort: '0x1234…abcd',
        qr: `fuda:v1:0x${'ab'.repeat(32)}`,
        tierLabel: 'FREE',
        uid: `0x${'ab'.repeat(32)}`,
      },
    )
    expect(obj.cardTitle.defaultValue.value).toBe('Wassie Coffee')
    expect(obj.header.defaultValue.value).toBe('Membership Card')
    expect(obj.subheader?.defaultValue.value).toBe('QJ2Y-XPHE-PDRKA')
    expect(obj.hexBackgroundColor).toBe('#6F4320')
    expect(obj.textModulesData[0]).toStrictEqual({
      body: 'QJ2Y-XPHE-PDRKA',
      header: 'Member number',
      id: 'member',
    })
  })
})

describe(mergeStampModules, () => {
  it('replaces prior stamp modules while preserving unrelated modules', () => {
    expect(
      mergeStampModules(
        [
          { body: 'VIP', header: 'Tier', id: 'tier' },
          { body: '1 / 10', header: 'Stamps', id: 'fuda-stamps' },
          { body: 'old', header: 'Today', id: 'fuda-stamps-today' },
        ],
        { dailyLimit: 2, enabled: true, goal: 10, today: 2, total: 4 },
      ),
    ).toStrictEqual([
      { body: 'VIP', header: 'Tier', id: 'tier' },
      { body: '4 / 10', header: 'Stamps', id: 'fuda-stamps' },
    ])
  })
})

describe(googleAccessToken, () => {
  it('exchanges a signed service-account assertion for a Wallet issuer token', async () => {
    const { cfg } = await fixture
    const requests: Request[] = []
    // oxlint-disable-next-line require-await -- Fetch-compatible test double
    const token = await googleAccessToken(cfg, IAT, async (input, init) => {
      requests.push(new Request(input, init))
      return Response.json({ access_token: 'access' })
    })
    expect(token).toBe('access')
    expect(requests[0]?.url).toBe('https://oauth2.googleapis.com/token')
    expect(requests[0]?.method).toBe('POST')
    const body = await requests[0]?.text()
    expect(body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer')
  })
})

describe(patchGoogleGenericObject, () => {
  it('reads the saved object and patches merged stamp modules only', async () => {
    const requests: Request[] = []
    // oxlint-disable-next-line require-await -- Fetch-compatible test double
    const request = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const current = new Request(input, init)
      requests.push(current)
      if (current.method === 'GET') {
        return Response.json({ textModulesData: [{ body: 'VIP', header: 'Tier', id: 'tier' }] })
      }
      return Response.json({})
    }
    await patchGoogleGenericObject(
      { classId: 'c', issuerId: '338', saEmail: 'e', saKeyPem: 'p' },
      UID,
      { dailyLimit: 1, enabled: true, goal: 10, today: 1, total: 3 },
      'access',
      request,
    )
    expect(requests.map(({ method }) => method)).toStrictEqual(['GET', 'PATCH'])
    expect(requests[1]?.url).toBe(
      `https://walletobjects.googleapis.com/walletobjects/v1/genericObject/338.${UID.slice(2)}`,
    )
    await expect(requests[1]?.json()).resolves.toStrictEqual({
      textModulesData: [
        { body: 'VIP', header: 'Tier', id: 'tier' },
        { body: '3 / 10', header: 'Stamps', id: 'fuda-stamps' },
      ],
    })
  })
})
