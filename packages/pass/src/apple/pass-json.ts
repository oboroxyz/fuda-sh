import type { BadgeView, Hex, StampSummary } from '@fuda/sdk'

import { BADGE_LABELS, hexToRgb, issuedDayIso, rgbCss, roleLabel, textOn } from '../branding.ts'
import type { PassBranding } from '../branding.ts'
import { passDate } from '../validity.ts'
import type { PassValidity } from '../validity.ts'

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
  hasStrip?: boolean
  stamps?: StampSummary | null
  // the badges on the right when the .pkpass is generated, so a member who badged
  // first and added the pass afterwards sees it at once
  badges?: readonly BadgeView[] | null
  validity: PassValidity
  // where Wallet asks for updates; without it the installed pass stays a snapshot, and
  // a re-add replaces it, since the serial number is the uid
  webService?: AppleWebServiceFields | null
}

export interface AppleWebServiceFields {
  // Apple never lets an update change this, so it must stay derivable for the life of a pass
  authenticationToken: string
  url: string
}

interface PassField {
  key: string
  // Wallet renders a small subset of HTML here and makes an anchor tappable;
  // `value` stays the plain text a client without it falls back to.
  attributedValue?: string
  // the alert Wallet shows when this value changes; without it the pass updates silently
  changeMessage?: string
  // omitted (not empty) for a value that stands on its own, such as the card title
  label?: string
  value: string
  // set together for a date value: Wallet formats it in the device locale
  dateStyle?: 'PKDateStyleMedium'
  timeStyle?: 'PKDateStyleNone'
  ignoresTimeZone?: boolean
}

export interface PassJson {
  authenticationToken?: string
  formatVersion: number
  passTypeIdentifier: string
  teamIdentifier: string
  organizationName: string
  serialNumber: string
  description: string
  foregroundColor: string
  backgroundColor: string
  labelColor: string
  // beside the logo; the venue name on a branded pass
  logoText?: string
  expirationDate?: string
  voided?: boolean
  webServiceURL?: string
  barcodes: { format: string; message: string; messageEncoding: string }[]
  locations?: { latitude: number; longitude: number; relevantText: string }[]
  storeCard: {
    headerFields?: PassField[]
    primaryFields: PassField[]
    secondaryFields: PassField[]
    auxiliaryFields?: PassField[]
    backFields: PassField[]
  }
}

// The way back to fuda's own page, where badging and everything else a wallet
// cannot host happens. An anchor because a bare URL is only sometimes tappable,
// and last on the back because it is an action, not a fact about the Right.
const manageFields = (manageUrl: string | null | undefined): PassField[] =>
  manageUrl === null || manageUrl === undefined
    ? []
    : [
        {
          attributedValue: `<a href="${manageUrl}">Open in fuda</a>`,
          key: 'manage',
          label: 'fuda',
          value: manageUrl,
        },
      ]

// The fact of each badge, as a front-of-pass auxiliary row — the family the
// stamp count already uses, so the member reads it without flipping the pass,
// and on the back it would be lost among the tier and the attestation uid.
// Only `kind` is read: a BadgeView also names the verifier and the times, and
// a pass must carry neither.
const badgeFields = (badges: readonly BadgeView[] | null | undefined): PassField[] =>
  (badges ?? []).map((badge) => ({
    changeMessage: 'Badge: %@',
    key: `badge-${badge.kind}`,
    label: 'BADGE',
    value: BADGE_LABELS[badge.kind],
  }))

const stampField = ({ goal, total }: StampSummary): PassField => ({
  changeMessage: 'Stamps: %@',
  key: 'stamps',
  label: 'STAMPS',
  value: `${total} / ${goal}`,
})

const NOT_VALID = 'No longer valid'

const isVoided = (input: ApplePassInput): boolean =>
  ['revoked', 'expired', 'consumed'].includes(input.validity.status)

const validityFields = (input: ApplePassInput): PassField[] => {
  const start = passDate(input.validity.validFrom)
  return start === undefined
    ? []
    : [
        {
          dateStyle: 'PKDateStyleMedium',
          key: 'valid-from',
          label: 'Valid from',
          value: start,
        },
      ]
}

// The front shows an invalid pass immediately; the back field announces changes.
const invalidFields = (input: ApplePassInput): PassField[] =>
  isVoided(input) ? [{ key: 'revoked', label: 'STATUS', value: NOT_VALID }] : []

// A pass that can be updated carries this from the start, so that a revocation changes a
// value Wallet already knows and can announce. A snapshot could only ever go stale saying
// "Valid", so it carries the field only once it has something true to say.
const STATUS_LABELS = {
  active: 'Valid',
  consumed: NOT_VALID,
  expired: NOT_VALID,
  not_yet_valid: 'Not yet valid',
  revoked: NOT_VALID,
  unknown: 'Unknown',
}

const statusFields = (input: ApplePassInput): PassField[] => {
  const invalid = isVoided(input)
  return invalid || (input.webService ?? null) !== null
    ? [
        {
          changeMessage: 'Status: %@',
          key: 'status',
          label: 'Status',
          value: STATUS_LABELS[input.validity.status],
        },
      ]
    : []
}

const webServiceOf = (
  service: AppleWebServiceFields | null | undefined,
): Pick<PassJson, 'authenticationToken' | 'webServiceURL'> =>
  service === null || service === undefined
    ? {}
    : { authenticationToken: service.authenticationToken, webServiceURL: service.url }

// Apple's own mark of a pass that no longer applies. Absent rather than false on a valid
// pass, the shape every pass had before.
const appleValidity = (input: ApplePassInput): Pick<PassJson, 'voided' | 'expirationDate'> => {
  const result: Pick<PassJson, 'voided' | 'expirationDate'> = {}
  if (isVoided(input)) {
    result.voided = true
  }
  const expiry = passDate(input.validity.validUntil)
  if (expiry !== undefined) {
    result.expirationDate = expiry
  }
  return result
}

// Omitted rather than sent empty: the shape the stamps path already produced,
// and the one the tests pin. What Wallet does with an empty array is untested.
const auxiliaryOf = (fields: PassField[]): { auxiliaryFields?: PassField[] } =>
  fields.length === 0 ? {} : { auxiliaryFields: fields }

// docs/specs/pass-types-and-flows.md#passes. The barcode carries the same `fuda:v1:<uid>` payload the
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
    ...webServiceOf(input.webService),
    ...appleValidity(input),
  }
  if (branding === null) {
    const stamps = input.stamps?.enabled === true ? input.stamps : null
    // The plain fuda look has no auxiliary row of its own, so a badge is the
    // only thing that can put one there.
    const auxiliary = auxiliaryOf([...invalidFields(input), ...badgeFields(input.badges)])
    return {
      ...base,
      backgroundColor: 'rgb(20,20,20)',
      description: 'fuda membership',
      foregroundColor: 'rgb(255,255,255)',
      labelColor: 'rgb(170,170,170)',
      organizationName: 'fuda',
      storeCard: {
        ...auxiliary,
        backFields: [
          ...statusFields(input),
          ...validityFields(input),
          { key: 'uid', label: 'Attestation', value: input.uid },
        ],
        primaryFields:
          stamps === null ? [{ key: 'tier', label: 'TIER', value: input.tierLabel }] : [stampField(stamps)],
        secondaryFields:
          stamps === null
            ? [{ key: 'member', label: 'MEMBER', value: input.holderShort }]
            : [
                { key: 'tier', label: 'TIER', value: input.tierLabel },
                { key: 'member', label: 'MEMBER', value: input.holderShort },
              ],
      },
    }
  }
  // A venue card, laid out like the card page in the app: the venue name
  // beside the logo, the card title large, then the member number under its
  // role label and the issue day. Tier is a fuda detail the card page never
  // shows, so it goes on the back; an enabled stamp count and any badge take
  // the row below.
  // The venue location, when the card asks for it, has Wallet surface the pass
  // on the lock screen nearby.
  const header: Pick<PassJson['storeCard'], 'headerFields'> = {}
  if (input.hasStrip === true) {
    header.headerFields = [{ key: 'title', value: branding.cardTitle }]
  }
  const { label, text } = textOn(branding.brandColor)
  const stamps = input.stamps?.enabled === true ? input.stamps : null
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
  const stampFields: PassField[] = stamps === null ? [] : [stampField(stamps)]
  const auxiliary = auxiliaryOf([...invalidFields(input), ...stampFields, ...badgeFields(input.badges)])
  return {
    ...base,
    ...locations,
    backgroundColor: rgbCss(hexToRgb(branding.brandColor)),
    description: branding.cardTitle,
    foregroundColor: rgbCss(text),
    labelColor: rgbCss(label),
    logoText: branding.issuerName,
    organizationName: branding.issuerName,
    storeCard: {
      ...auxiliary,
      backFields: [
        ...statusFields(input),
        ...validityFields(input),
        { key: 'tier', label: 'Tier', value: input.tierLabel },
        { key: 'holder', label: 'Holder', value: input.holderShort },
        { key: 'uid', label: 'Attestation', value: input.uid },
        ...manageFields(branding.manageUrl),
      ],
      ...header,
      primaryFields: input.hasStrip === true ? [] : [{ key: 'title', value: branding.cardTitle }],
      secondaryFields: [
        { key: 'member', label: roleLabel(branding.category), value: branding.memberNumber },
        {
          dateStyle: 'PKDateStyleMedium',
          ignoresTimeZone: true,
          key: 'issued',
          label: 'ISSUED',
          timeStyle: 'PKDateStyleNone',
          value: issuedDayIso(branding.issuedAt),
        },
      ],
    },
  }
}
