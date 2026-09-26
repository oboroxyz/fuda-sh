import type { BadgeKind, BadgeView, Hex, StampSummary } from '@fuda/sdk'
import { BADGE_KINDS } from '@fuda/sdk'

import { base64urlBytes, base64urlText } from './base64url.ts'
import { BADGE_LABELS, issuedDayText, roleLabel } from './branding.ts'
import type { PassBranding } from './branding.ts'
import { pemToDer } from './pem.ts'

export interface GoogleConfig {
  issuerId: string
  classId: string
  saEmail: string
  saKeyPem: string
}

export type GoogleEnv = Partial<
  Record<'GOOGLE_ISSUER_ID' | 'GOOGLE_CLASS_ID' | 'GOOGLE_SA_EMAIL' | 'GOOGLE_SA_KEY_PEM', string>
>

// null unless all four secrets are present and non-empty: a half-configured
// deployment answers 501 rather than minting a JWT no wallet would accept.
export const googleConfigFrom = (env: GoogleEnv): GoogleConfig | null => {
  const issuerId = env.GOOGLE_ISSUER_ID ?? ''
  const classId = env.GOOGLE_CLASS_ID ?? ''
  const saEmail = env.GOOGLE_SA_EMAIL ?? ''
  const saKeyPem = env.GOOGLE_SA_KEY_PEM ?? ''
  if (issuerId === '' || classId === '' || saEmail === '' || saKeyPem === '') {
    return null
  }
  return { classId, issuerId, saEmail, saKeyPem }
}

export interface GooglePassInput {
  // the attestation uid; its 0x-less form is the object id suffix
  uid: Hex
  // FREE | REGULAR | VIP | FOUNDER, or `TIER n` for an unknown tier
  tierLabel: string
  // the holder as rendered on the pass page (`0x1234…abcd`, or `—`)
  holderShort: string
  // the QR payload: `fuda:v1:<uid>`
  qr: string
  // the venue's card, when the right was issued under one
  branding?: PassBranding | null
  stamps?: StampSummary | null
  // the badges on the right at generation time, so a pass added *after* a
  // badge carries it without waiting for a patch. Only the fact of each badge
  // reaches the object; see mergeBadgeModules.
  badges?: readonly BadgeView[] | null
}

interface LocalizedString {
  defaultValue: { language: string; value: string }
}

export interface TextModule {
  body: string
  header: string
  id: string
}

interface WalletImage {
  sourceUri: { uri: string }
}

export interface GoogleGenericObject {
  barcode: { alternateText: string; type: string; value: string }
  cardTitle: LocalizedString
  classId: string
  header: LocalizedString
  hexBackgroundColor?: string
  id: string
  logo?: WalletImage
  smartTapRedemptionValue: string
  state: string
  subheader?: LocalizedString
  textModulesData: TextModule[]
}

const localized = (value: string): LocalizedString => ({ defaultValue: { language: 'en-US', value } })

const STAMP_IDS = new Set(['fuda-stamps', 'fuda-stamps-today'])

export const mergeStampModules = (
  modules: readonly TextModule[],
  stamps: StampSummary | null,
): TextModule[] => {
  const preserved = modules.filter(({ id }) => !STAMP_IDS.has(id))
  if (stamps?.enabled !== true) {
    return preserved
  }
  return [...preserved, { body: `${stamps.total} / ${stamps.goal}`, header: 'Stamps', id: 'fuda-stamps' }]
}

// One id per BadgeKind, so a future kind gets its own row instead of
// overwriting `human`'s. Only 'human' ships today; the row's text is the
// shared BADGE_LABELS entry, so the Apple pass and this one cannot drift.
const badgeModuleId = (kind: BadgeKind): string => `fuda-badge-${kind}`

const BADGE_IDS = new Set(BADGE_KINDS.map(badgeModuleId))

// Symmetric with mergeStampModules: filters only the badge-kind ids it owns
// and preserves every other module (stamps included), so patching one never
// deletes the other's rows.
export const mergeBadgeModules = (
  modules: readonly TextModule[],
  badges: readonly BadgeView[],
): TextModule[] => {
  const preserved = modules.filter(({ id }) => !BADGE_IDS.has(id))
  const added = badges.map((badge): TextModule => ({
    body: BADGE_LABELS[badge.kind],
    header: 'Badge',
    id: badgeModuleId(badge.kind),
  }))
  return [...preserved, ...added]
}

// docs/specs/pass-types-and-flows.md#passes. The object id is issuer-scoped and must be unique per pass, so the
// attestation uid (without its 0x) is the suffix.
export const buildGenericObject = (cfg: GoogleConfig, input: GooglePassInput): GoogleGenericObject => {
  const base = {
    barcode: { alternateText: input.uid.slice(0, 10), type: 'QR_CODE', value: input.qr },
    classId: cfg.classId,
    id: `${cfg.issuerId}.${input.uid.slice(2)}`,
    smartTapRedemptionValue: input.qr,
    state: 'ACTIVE',
  }
  const branding = input.branding ?? null
  if (branding === null) {
    return {
      ...base,
      cardTitle: localized('fuda membership'),
      header: localized(input.tierLabel),
      textModulesData: mergeBadgeModules(
        mergeStampModules(
          [
            { body: input.tierLabel, header: 'Tier', id: 'tier' },
            { body: input.holderShort, header: 'Member', id: 'member' },
          ],
          input.stamps ?? null,
        ),
        input.badges ?? [],
      ),
    }
  }
  // A venue card: the venue is the title, the card title the header, the
  // member number the subheader, and the brand colour the card. The detail
  // modules read like the app's card page (role label, issue day); tier is a
  // fuda detail the card page never shows. The logo is a URL Google fetches,
  // so it is omitted rather than empty when unset.
  const logo = branding.logoUrl === null ? {} : { logo: { sourceUri: { uri: branding.logoUrl } } }
  return {
    ...base,
    ...logo,
    cardTitle: localized(branding.issuerName),
    header: localized(branding.cardTitle),
    hexBackgroundColor: branding.brandColor,
    subheader: localized(branding.memberNumber),
    textModulesData: mergeBadgeModules(
      mergeStampModules(
        [
          { body: branding.memberNumber, header: roleLabel(branding.category), id: 'member' },
          { body: issuedDayText(branding.issuedAt), header: 'ISSUED', id: 'issued' },
        ],
        input.stamps ?? null,
      ),
      input.badges ?? [],
    ),
  }
}

export interface GoogleJwtClaims {
  aud: string
  iat: number
  iss: string
  origins: string[]
  payload: { genericObjects: GoogleGenericObject[] }
  typ: string
}

interface GoogleOAuthClaims {
  aud: string
  exp: number
  iat: number
  iss: string
  scope: string
}

// The service-account private key, imported for signing only: `extractable`
// is false, so the key material can never leave the isolate.
export const importRs256Key = async (pem: string): Promise<CryptoKey> =>
  await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(pem, 'PRIVATE KEY'),
    { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' },
    false,
    ['sign'],
  )

// A compact JWS by hand: workerd has WebCrypto but no Node crypto, and the
// only algorithm Google's save link accepts is RS256.
export const signJwtRs256 = async (
  key: CryptoKey,
  claims: GoogleJwtClaims | GoogleOAuthClaims,
): Promise<string> => {
  const head = base64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = base64urlText(JSON.stringify(claims))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${base64urlBytes(new Uint8Array(sig))}`
}

type PassRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const checked = (response: Response): Response => {
  if (!response.ok) {
    throw new Error(`Google Wallet request failed (${response.status})`)
  }
  return response
}

export const googleAccessToken = async (
  cfg: GoogleConfig,
  now: number,
  request: PassRequest = globalThis.fetch,
): Promise<string> => {
  const assertion = await signJwtRs256(await importRs256Key(cfg.saKeyPem), {
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
    iss: cfg.saEmail,
    scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
  })
  const body = new URLSearchParams({
    assertion,
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
  })
  const value: unknown = await checked(
    await request('https://oauth2.googleapis.com/token', {
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    }),
  ).json()
  /* oxlint-disable anti-slop/no-runtime-typeof -- OAuth JSON is parsed and accepted only with a string access_token */
  if (
    value === null ||
    typeof value !== 'object' ||
    !('access_token' in value) ||
    typeof value.access_token !== 'string'
  ) {
    throw new Error('Google OAuth response did not contain an access token')
  }
  /* oxlint-enable anti-slop/no-runtime-typeof */
  return value.access_token
}

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion -- this block parses Google Wallet's external JSON */
const textModulesFrom = (value: unknown): TextModule[] => {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('textModulesData' in value) ||
    !Array.isArray(value.textModulesData)
  ) {
    return []
  }
  return value.textModulesData.flatMap((item: unknown): TextModule[] => {
    if (item === null || typeof item !== 'object') {
      return []
    }
    // SAFETY: every field copied below is checked as a string first.
    const candidate = item as Partial<TextModule>
    if (
      typeof candidate.body !== 'string' ||
      typeof candidate.header !== 'string' ||
      typeof candidate.id !== 'string'
    ) {
      return []
    }
    return [{ body: candidate.body, header: candidate.header, id: candidate.id }]
  })
}
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion */

// Shared read-modify-write for both stamps and badges: GET the saved object,
// hand its current text modules to `transform`, then PATCH the result back.
//
// A 404 on the GET means this member has no saved Google object — most don't:
// every iOS member, every browser-only member, and anyone who tapped "Add to
// Google Wallet" but never finished. Google creates the object only when the
// save completes (see buildGoogleSaveUrl's comment), so fuda cannot know in
// advance which members have one. That is the normal case, not a failure, so
// it returns quietly with nothing patched and nothing logged. Any other
// non-ok status (auth failure, a real API error) still throws, via `checked`,
// exactly as before.
const patchTextModules = async (
  cfg: GoogleConfig,
  uid: Hex,
  accessToken: string,
  transform: (modules: readonly TextModule[]) => TextModule[],
  request: PassRequest = globalThis.fetch,
): Promise<void> => {
  const objectId = `${cfg.issuerId}.${uid.slice(2)}`
  const url = `https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${objectId}`
  const headers = { authorization: `Bearer ${accessToken}` }
  const getResponse = await request(url, { headers })
  if (getResponse.status === 404) {
    return
  }
  const current: unknown = await checked(getResponse).json()
  const modules = textModulesFrom(current)
  await checked(
    await request(url, {
      body: JSON.stringify({ textModulesData: transform(modules) }),
      headers: { ...headers, 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  ).json()
}

export const patchGoogleGenericObject = async (
  cfg: GoogleConfig,
  uid: Hex,
  stamps: StampSummary,
  accessToken: string,
  request: PassRequest = globalThis.fetch,
): Promise<void> => {
  await patchTextModules(cfg, uid, accessToken, (modules) => mergeStampModules(modules, stamps), request)
}

export const patchGoogleBadgeModules = async (
  cfg: GoogleConfig,
  uid: Hex,
  badges: readonly BadgeView[],
  accessToken: string,
  request: PassRequest = globalThis.fetch,
): Promise<void> => {
  await patchTextModules(cfg, uid, accessToken, (modules) => mergeBadgeModules(modules, badges), request)
}

export const GOOGLE_SAVE_BASE = 'https://pay.google.com/gp/v/save/'

// The whole pass travels inside the link: Google reads the object out of the
// signed payload, so no Wallet API call is needed to create it.
export const buildGoogleSaveUrl = async (
  cfg: GoogleConfig,
  input: GooglePassInput,
  origins: string[],
  now: number,
): Promise<string> => {
  const key = await importRs256Key(cfg.saKeyPem)
  const jwt = await signJwtRs256(key, {
    aud: 'google',
    iat: now,
    iss: cfg.saEmail,
    origins,
    payload: { genericObjects: [buildGenericObject(cfg, input)] },
    typ: 'savetowallet',
  })
  return `${GOOGLE_SAVE_BASE}${jwt}`
}
