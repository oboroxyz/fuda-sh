import type { BadgeView, Hex } from '@fuda/sdk'
import { describe, expect, it } from 'vitest'

import { appleConfigFrom, passJson } from './pass-json.ts'
import type { AppleConfig, AppleEnv, ApplePassInput } from './pass-json.ts'

// 2026-09-12T00:00:00Z, the issue day the fixtures show
const ISSUED_AT = 1_789_171_200

const UID: Hex = `0x${'ab'.repeat(32)}`

const CFG: AppleConfig = {
  certPem: 'cert',
  keyPem: 'key',
  passTypeId: 'pass.sh.fuda.membership',
  teamId: 'TEAM123456',
  wwdrPem: 'wwdr',
}

const FULL_ENV: AppleEnv = {
  APPLE_CERT_PEM: 'cert',
  APPLE_KEY_PEM: 'key',
  APPLE_PASS_TYPE_ID: 'pass.sh.fuda.membership',
  APPLE_TEAM_ID: 'TEAM123456',
  APPLE_WWDR_PEM: 'wwdr',
}

const INPUT = {
  holderShort: '0x1234…abcd',
  qr: `fuda:v1:${UID}`,
  tierLabel: 'VIP',
  uid: UID,
  validity: { status: 'active' as const, validFrom: 0, validUntil: 0 },
}

describe(appleConfigFrom, () => {
  it('reads the five secrets into a config', () => {
    expect(appleConfigFrom(FULL_ENV)).toStrictEqual(CFG)
  })

  it('is null when any one of the five is missing or empty', () => {
    for (const key of Object.keys(FULL_ENV)) {
      const partial = { ...FULL_ENV, [key]: undefined }
      expect(appleConfigFrom(partial)).toBeNull()
    }
    expect(appleConfigFrom({ ...FULL_ENV, APPLE_TEAM_ID: '' })).toBeNull()
  })
})

describe(passJson, () => {
  it('is a storeCard identified by the pass type, team and attestation uid', () => {
    const json = passJson(CFG, INPUT)
    expect(json.formatVersion).toBe(1)
    expect(json.passTypeIdentifier).toBe('pass.sh.fuda.membership')
    expect(json.teamIdentifier).toBe('TEAM123456')
    expect(json.organizationName).toBe('fuda')
    expect(json.serialNumber).toBe(UID)
  })

  it('carries the same fuda:v1 QR payload the browser pass shows', () => {
    expect(passJson(CFG, INPUT).barcodes).toStrictEqual([
      { format: 'PKBarcodeFormatQR', message: `fuda:v1:${UID}`, messageEncoding: 'iso-8859-1' },
    ])
  })

  it('shows the tier, the short holder and the uid on the back', () => {
    const { storeCard } = passJson(CFG, INPUT)
    expect(storeCard.primaryFields).toStrictEqual([{ key: 'tier', label: 'TIER', value: 'VIP' }])
    expect(storeCard.secondaryFields).toStrictEqual([
      { key: 'member', label: 'MEMBER', value: '0x1234…abcd' },
    ])
    expect(storeCard.backFields).toStrictEqual([{ key: 'uid', label: 'Attestation', value: UID }])
  })

  it('uses the dark fuda palette', () => {
    const json = passJson(CFG, INPUT)
    expect(json.foregroundColor).toBe('rgb(255,255,255)')
    expect(json.backgroundColor).toBe('rgb(20,20,20)')
    expect(json.labelColor).toBe('rgb(170,170,170)')
    expect(json.description).toBe('fuda membership')
  })

  it('shows a stamp snapshot when stamps are enabled', () => {
    const json = passJson(CFG, {
      ...INPUT,
      stamps: { dailyLimit: 2, enabled: true, goal: 10, today: 1, total: 4 },
    })
    expect(json.storeCard.primaryFields).toStrictEqual([
      { changeMessage: 'Stamps: %@', key: 'stamps', label: 'STAMPS', value: '4 / 10' },
    ])
    expect(json.storeCard.secondaryFields).toStrictEqual([
      { key: 'tier', label: 'TIER', value: 'VIP' },
      { key: 'member', label: 'MEMBER', value: '0x1234…abcd' },
    ])
  })
})

const branded = () =>
  passJson(
    { certPem: '', keyPem: '', passTypeId: 'pass.sh.fuda', teamId: 'TEAM', wwdrPem: '' },
    {
      branding: {
        artworkUrl: null,
        brandColor: '#6F4320',
        cardTitle: 'Membership Card',
        category: 'membership',
        issuedAt: ISSUED_AT,
        issuerName: 'Wassie Coffee',
        logoUrl: null,
        memberNumber: 'QJ2Y-XPHE-PDRKA',
        venue: { lat: 35.665, lng: 139.712 },
      },
      holderShort: '0x1234…abcd',
      qr: `fuda:v1:0x${'ab'.repeat(32)}`,
      tierLabel: 'FREE',
      uid: `0x${'ab'.repeat(32)}`,
      validity: INPUT.validity,
    },
  )

describe('branded pass.json', () => {
  it('names the venue and card and paints the brand colour with readable text', () => {
    const json = branded()
    expect(json.organizationName).toBe('Wassie Coffee')
    expect(json.description).toBe('Membership Card')
    expect(json.backgroundColor).toBe('rgb(111,67,32)')
    expect(json.foregroundColor).toBe('rgb(255,255,255)')
  })

  it('lays the face out like the card page: venue by the logo, title large, member number and issue day below', () => {
    const json = branded()
    expect(json.logoText).toBe('Wassie Coffee')
    expect(json.storeCard.primaryFields).toStrictEqual([{ key: 'title', value: 'Membership Card' }])
    expect(json.storeCard.secondaryFields).toStrictEqual([
      { key: 'member', label: 'MEMBER', value: 'QJ2Y-XPHE-PDRKA' },
      {
        dateStyle: 'PKDateStyleMedium',
        ignoresTimeZone: true,
        key: 'issued',
        label: 'ISSUED',
        timeStyle: 'PKDateStyleNone',
        value: '2026-09-12T00:00:00Z',
      },
    ])
    expect(json.storeCard.auxiliaryFields).toBeUndefined()
  })

  it('puts the member page on the back as a tappable link, when there is one', () => {
    const json = passJson(
      { certPem: '', keyPem: '', passTypeId: 'pass.sh.fuda', teamId: 'TEAM', wwdrPem: '' },
      {
        branding: {
          artworkUrl: null,
          brandColor: '#6F4320',
          cardTitle: 'Membership Card',
          category: 'membership',
          issuedAt: ISSUED_AT,
          issuerName: 'Wassie Coffee',
          logoUrl: null,
          manageUrl: 'https://fuda.sh/@wassie-coffee/members',
          memberNumber: 'QJ2Y-XPHE-PDRKA',
          venue: null,
        },
        holderShort: '0x1234…abcd',
        qr: `fuda:v1:0x${'ab'.repeat(32)}`,
        tierLabel: 'FREE',
        uid: `0x${'ab'.repeat(32)}`,
        validity: INPUT.validity,
      },
    )
    expect(json.storeCard.backFields.at(-1)).toStrictEqual({
      attributedValue: '<a href="https://fuda.sh/@wassie-coffee/members">Open in fuda</a>',
      key: 'manage',
      label: 'fuda',
      value: 'https://fuda.sh/@wassie-coffee/members',
    })
  })

  it('leaves the back unchanged for a right with no member page', () => {
    expect(branded().storeCard.backFields.map(({ key }) => key)).toStrictEqual(['tier', 'holder', 'uid'])
  })

  it('keeps the tier off the face and puts the venue in locations', () => {
    const json = branded()
    expect(json.storeCard.backFields[0]).toStrictEqual({ key: 'tier', label: 'Tier', value: 'FREE' })
    expect(json.locations).toStrictEqual([
      { latitude: 35.665, longitude: 139.712, relevantText: 'Wassie Coffee' },
    ])
  })

  it('adds an enabled stamp snapshot below the member details', () => {
    const json = passJson(
      { certPem: '', keyPem: '', passTypeId: 'pass.sh.fuda', teamId: 'TEAM', wwdrPem: '' },
      {
        branding: {
          artworkUrl: null,
          brandColor: '#6F4320',
          cardTitle: 'Membership Card',
          category: 'membership',
          issuedAt: ISSUED_AT,
          issuerName: 'Wassie Coffee',
          logoUrl: null,
          memberNumber: 'QJ2Y-XPHE-PDRKA',
          venue: null,
        },
        holderShort: '0x1234…abcd',
        qr: `fuda:v1:${UID}`,
        stamps: { dailyLimit: 2, enabled: true, goal: 10, today: 1, total: 4 },
        tierLabel: 'VIP',
        uid: UID,
        validity: INPUT.validity,
      },
    )
    expect(json.storeCard.primaryFields).toStrictEqual([{ key: 'title', value: 'Membership Card' }])
    expect(json.storeCard.secondaryFields[0]).toStrictEqual({
      key: 'member',
      label: 'MEMBER',
      value: 'QJ2Y-XPHE-PDRKA',
    })
    expect(json.storeCard.auxiliaryFields).toStrictEqual([
      { changeMessage: 'Stamps: %@', key: 'stamps', label: 'STAMPS', value: '4 / 10' },
    ])
  })
})

// A member who badges first and adds the pass afterwards sees the badge from the download.
describe('badge on a generated pass.json', () => {
  const BADGE: BadgeView = { at: 1_757_000_000, kind: 'human', verifier: 'world' }
  const BADGE_FIELD = {
    changeMessage: 'Badge: %@',
    key: 'badge-human',
    label: 'BADGE',
    value: 'Verified human',
  }

  it('shows the badge on the front of a plain pass', () => {
    const json = passJson(CFG, { ...INPUT, badges: [BADGE] })
    expect(json.storeCard.auxiliaryFields).toStrictEqual([BADGE_FIELD])
  })

  it('shows it after the stamp count on a branded pass', () => {
    const json = passJson(CFG, {
      ...INPUT,
      badges: [BADGE],
      branding: {
        artworkUrl: null,
        brandColor: '#6F4320',
        cardTitle: 'Membership Card',
        category: 'membership',
        issuedAt: ISSUED_AT,
        issuerName: 'Wassie Coffee',
        logoUrl: null,
        memberNumber: 'QJ2Y-XPHE-PDRKA',
        venue: null,
      },
      stamps: { dailyLimit: 2, enabled: true, goal: 10, today: 1, total: 4 },
    })
    expect(json.storeCard.auxiliaryFields).toStrictEqual([
      { changeMessage: 'Stamps: %@', key: 'stamps', label: 'STAMPS', value: '4 / 10' },
      BADGE_FIELD,
    ])
  })

  it('omits the row rather than sending it empty when no badge is held', () => {
    expect(passJson(CFG, { ...INPUT, badges: [] }).storeCard.auxiliaryFields).toBeUndefined()
  })

  // The pass carries the fact of the badge and nothing else: not the verifier's
  // name, not the scope, not the subject key.
  it('names neither the verifier nor anything else from the badge row', () => {
    const json = JSON.stringify(passJson(CFG, { ...INPUT, badges: [BADGE] }))
    expect(json).not.toContain('world')
    expect(json).not.toContain(String(BADGE.at))
  })
})

describe('an updatable or revoked pass', () => {
  const STAMPS = { dailyLimit: 1, enabled: true, goal: 10, today: 0, total: 3 }
  const SERVICE = { authenticationToken: 'token-of-sixteen-chars', url: 'https://api.test/apple' }
  const BRANDED = {
    artworkUrl: null,
    brandColor: '#112233',
    cardTitle: 'Coffee',
    category: 'membership',
    issuedAt: ISSUED_AT,
    issuerName: 'Wassie Coffee',
    logoUrl: null,
    manageUrl: null,
    memberNumber: '1234-5678-90123',
    venue: null,
  } as const

  it('names no web service and no status on a snapshot', () => {
    const json = passJson(CFG, { ...INPUT, webService: null })
    expect(json.webServiceURL).toBeUndefined()
    expect(json.authenticationToken).toBeUndefined()
    expect(json.voided).toBeUndefined()
    expect(json.storeCard.backFields.map(({ key }) => key)).not.toContain('status')
  })

  it('carries the web service, and a status Wallet can announce a change to', () => {
    for (const branding of [null, BRANDED]) {
      const json = passJson(CFG, { ...INPUT, branding, webService: SERVICE })
      expect(json.webServiceURL).toBe('https://api.test/apple')
      expect(json.authenticationToken).toBe('token-of-sixteen-chars')
      const status = json.storeCard.backFields.find(({ key }) => key === 'status')
      expect(status?.value).toBe('Valid')
      expect(status?.changeMessage).toContain('%@')
    }
  })

  it('has a stamp count announce itself, branded or not', () => {
    const [onPlain] = passJson(CFG, { ...INPUT, stamps: STAMPS }).storeCard.primaryFields
    const [onCard] =
      passJson(CFG, { ...INPUT, branding: BRANDED, stamps: STAMPS }).storeCard.auxiliaryFields ?? []
    expect(onPlain?.changeMessage).toBe('Stamps: %@')
    expect(onCard?.changeMessage).toBe('Stamps: %@')
  })

  it('marks a revoked pass void and says so, front and back, even as a snapshot', () => {
    for (const branding of [null, BRANDED]) {
      const json = passJson(CFG, {
        ...INPUT,
        branding,
        validity: { status: 'revoked', validFrom: 0, validUntil: 0 },
      })
      expect(json.voided).toBe(true)
      expect(json.storeCard.auxiliaryFields?.[0]?.value).toBe('No longer valid')
      expect(json.storeCard.backFields.find(({ key }) => key === 'status')?.value).toBe('No longer valid')
    }
  })
})

describe('wallet status', () => {
  it.each(['revoked', 'expired', 'consumed'] as const)('voids %s with or without updates', (status) => {
    for (const webService of [null, { authenticationToken: 'token', url: 'https://api.fuda.sh/apple' }]) {
      const json = passJson(CFG, {
        ...INPUT,
        validity: { status, validFrom: 100, validUntil: 200 },
        webService,
      })
      expect(json.voided).toBe(true)
      expect(json.expirationDate).toBe('1970-01-01T00:03:20.000Z')
      expect(json.storeCard.backFields).toContainEqual(
        expect.objectContaining({ key: 'status', value: 'No longer valid' }),
      )
    }
  })

  it('shows a future start without voiding the pass', () => {
    const json = passJson(CFG, {
      ...INPUT,
      validity: { status: 'not_yet_valid', validFrom: 100, validUntil: 0 },
      webService: { authenticationToken: 'token', url: 'https://api.fuda.sh/apple' },
    })
    expect(json.voided).toBeUndefined()
    expect(json.expirationDate).toBeUndefined()
    expect(json.storeCard.backFields).toContainEqual(
      expect.objectContaining({ key: 'valid-from', value: '1970-01-01T00:01:40.000Z' }),
    )
    expect(json.storeCard.backFields).toContainEqual(
      expect.objectContaining({ key: 'status', value: 'Not yet valid' }),
    )
  })
})

describe('poster generic pass', () => {
  const branding = {
    artworkUrl: null,
    brandColor: '#112233',
    cardTitle: 'Coffee',
    category: 'membership' as const,
    issuedAt: ISSUED_AT,
    issuerName: 'Cafe',
    logoUrl: null,
    memberNumber: 'XXXX-XXXX-XXXXX',
    venue: null,
  }

  it('places details in priority order and preserves the storeCard fallback and change alerts', () => {
    const input: ApplePassInput = {
      ...INPUT,
      badges: [{ at: 1, kind: 'human', verifier: 'world' }],
      branding,
      hasStrip: true,
      stamps: { dailyLimit: 1, enabled: true, goal: 10, today: 0, total: 2 },
      validity: { ...INPUT.validity, status: 'revoked' as const },
    }
    const fallback = passJson(CFG, input)
    const result = passJson(CFG, { ...input, hasPoster: true })
    expect(result.storeCard).toStrictEqual(fallback.storeCard)
    expect(result.posterGeneric).toStrictEqual({
      additionalInfoFields: [
        { changeMessage: 'Badge: %@', key: 'badge-human', label: 'BADGE', value: 'Verified human' },
        {
          dateStyle: 'PKDateStyleMedium',
          ignoresTimeZone: true,
          key: 'issued',
          label: 'ISSUED',
          timeStyle: 'PKDateStyleNone',
          value: '2026-09-12T00:00:00Z',
        },
      ],
      backFields: fallback.storeCard.backFields,
      footerFields: [
        { key: 'revoked', label: 'STATUS', value: 'No longer valid' },
        { changeMessage: 'Stamps: %@', key: 'stamps', label: 'STAMPS', value: '2 / 10' },
      ],
      headerFields: [{ key: 'member', label: 'MEMBER', value: 'XXXX-XXXX-XXXXX' }],
      primaryFields: [{ key: 'title', value: 'Coffee' }],
    })
    expect([
      fallback.posterGeneric,
      passJson(CFG, { ...INPUT, hasPoster: true }).posterGeneric,
    ]).toStrictEqual([undefined, undefined])
  })

  it('uses the ticket role and lets the issue date reach the footer when no other details exist', () => {
    const result = passJson(CFG, { ...INPUT, branding: { ...branding, category: 'ticket' }, hasPoster: true })
    expect(result.posterGeneric?.headerFields[0]?.label).toBe('TICKET')
    expect(result.posterGeneric?.footerFields.map((field) => field.key)).toStrictEqual(['issued'])
    expect(result.posterGeneric?.additionalInfoFields).toStrictEqual([])
  })
})
