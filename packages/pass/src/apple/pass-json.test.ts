import type { Hex } from '@fuda/sdk'
import { describe, expect, it } from 'vitest'

import { appleConfigFrom, passJson } from './pass-json.ts'
import type { AppleConfig, AppleEnv } from './pass-json.ts'

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

const INPUT = { holderShort: '0x1234…abcd', qr: `fuda:v1:${UID}`, tierLabel: 'VIP', uid: UID }

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
    expect(json.storeCard.primaryFields).toStrictEqual([{ key: 'stamps', label: 'STAMPS', value: '4 / 10' }])
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
      },
    )
    expect(json.storeCard.primaryFields).toStrictEqual([{ key: 'title', value: 'Membership Card' }])
    expect(json.storeCard.secondaryFields[0]).toStrictEqual({
      key: 'member',
      label: 'MEMBER',
      value: 'QJ2Y-XPHE-PDRKA',
    })
    expect(json.storeCard.auxiliaryFields).toStrictEqual([
      { key: 'stamps', label: 'STAMPS', value: '4 / 10' },
    ])
  })
})
