import type { Hex } from '@fuda/sdk'

import { hexToRgb, rgbCss, textOn } from '../branding.ts'
import type { PassBranding } from '../branding.ts'

export interface AppleConfig {
  passTypeId: string
  teamId: string
  certPem: string
  keyPem: string
  wwdrPem: string
}

export type AppleEnv = Partial<
  Record<
    'APPLE_PASS_TYPE_ID' | 'APPLE_TEAM_ID' | 'APPLE_CERT_PEM' | 'APPLE_KEY_PEM' | 'APPLE_WWDR_PEM',
    string
  >
>

// null unless all five secrets are present and non-empty: a half-configured
// deployment answers 501 rather than emitting a pass no iPhone would install.
export const appleConfigFrom = (env: AppleEnv): AppleConfig | null => {
  const passTypeId = env.APPLE_PASS_TYPE_ID ?? ''
  const teamId = env.APPLE_TEAM_ID ?? ''
  const certPem = env.APPLE_CERT_PEM ?? ''
  const keyPem = env.APPLE_KEY_PEM ?? ''
  const wwdrPem = env.APPLE_WWDR_PEM ?? ''
  if (passTypeId === '' || teamId === '' || certPem === '' || keyPem === '' || wwdrPem === '') {
    return null
  }
  return { certPem, keyPem, passTypeId, teamId, wwdrPem }
}

export interface ApplePassInput {
  // the attestation uid; also the pass serial number
  uid: Hex
  // FREE | REGULAR | VIP | FOUNDER, or `TIER n` for an unknown tier
  tierLabel: string
  // the holder as rendered on the pass page (`0x1234…abcd`, or `—`)
  holderShort: string
  // the QR payload: `fuda:v1:<uid>`
  qr: string
  // the venue's card, when the right was issued under one
  branding?: PassBranding | null
}

interface PassField {
  key: string
  label: string
  value: string
}

export interface PassJson {
  formatVersion: number
  passTypeIdentifier: string
  teamIdentifier: string
  organizationName: string
  serialNumber: string
  description: string
  foregroundColor: string
  backgroundColor: string
  labelColor: string
  barcodes: { format: string; message: string; messageEncoding: string }[]
  locations?: { latitude: number; longitude: number; relevantText: string }[]
  storeCard: {
    primaryFields: PassField[]
    secondaryFields: PassField[]
    backFields: PassField[]
  }
}

// docs/specs/pass-types-and-flows.md#passes. A storeCard, not a coupon or event ticket: membership has no date
// and no venue. The barcode carries the same `fuda:v1:<uid>` payload the
// browser pass and the Google object do, so one scanner reads all three.
export const passJson = (cfg: AppleConfig, input: ApplePassInput): PassJson => {
  const branding = input.branding ?? null
  const base = {
    // iso-8859-1 is the only encoding Wallet's QR reader accepts, and the payload
    // is ASCII, so nothing is lost.
    barcodes: [{ format: 'PKBarcodeFormatQR', message: input.qr, messageEncoding: 'iso-8859-1' }],
    formatVersion: 1,
    passTypeIdentifier: cfg.passTypeId,
    serialNumber: input.uid,
    teamIdentifier: cfg.teamId,
  }
  if (branding === null) {
    return {
      ...base,
      backgroundColor: 'rgb(20,20,20)',
      description: 'fuda membership',
      foregroundColor: 'rgb(255,255,255)',
      labelColor: 'rgb(170,170,170)',
      organizationName: 'fuda',
      storeCard: {
        backFields: [{ key: 'uid', label: 'Attestation', value: input.uid }],
        primaryFields: [{ key: 'tier', label: 'TIER', value: input.tierLabel }],
        secondaryFields: [{ key: 'member', label: 'MEMBER', value: input.holderShort }],
      },
    }
  }
  // A venue card: brand colour with readable text, the member number up front,
  // and — when the card asks for it — the venue location so Wallet surfaces
  // the pass on the lock screen nearby.
  const { label, text } = textOn(branding.brandColor)
  const locations =
    branding.venue === null
      ? {}
      : {
          locations: [
            {
              latitude: branding.venue.lat,
              longitude: branding.venue.lng,
              relevantText: branding.issuerName,
            },
          ],
        }
  return {
    ...base,
    ...locations,
    backgroundColor: rgbCss(hexToRgb(branding.brandColor)),
    description: branding.cardTitle,
    foregroundColor: rgbCss(text),
    labelColor: rgbCss(label),
    organizationName: branding.issuerName,
    storeCard: {
      backFields: [
        { key: 'holder', label: 'Holder', value: input.holderShort },
        { key: 'uid', label: 'Attestation', value: input.uid },
      ],
      primaryFields: [{ key: 'member', label: 'MEMBER NO.', value: branding.memberNumber }],
      secondaryFields: [{ key: 'tier', label: 'TIER', value: input.tierLabel }],
    },
  }
}
