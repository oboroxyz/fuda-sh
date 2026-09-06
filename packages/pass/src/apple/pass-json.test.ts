import type { Hex } from '@fuda/sdk'
import { describe, expect, it } from 'vitest'

import { appleConfigFrom, passJson } from './pass-json.ts'
import type { AppleConfig, AppleEnv } from './pass-json.ts'

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
})
