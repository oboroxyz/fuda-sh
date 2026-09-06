import type { Hex } from '@fuda/sdk'

import { base64urlBytes, base64urlText } from './base64url.ts'
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
}

interface LocalizedString {
  defaultValue: { language: string; value: string }
}

interface TextModule {
  body: string
  header: string
  id: string
}

export interface GoogleGenericObject {
  barcode: { alternateText: string; type: string; value: string }
  cardTitle: LocalizedString
  classId: string
  header: LocalizedString
  id: string
  state: string
  textModulesData: TextModule[]
}

const localized = (value: string): LocalizedString => ({ defaultValue: { language: 'en-US', value } })

// docs/specs/pass-types-and-flows.md#passes. The object id is issuer-scoped and must be unique per pass, so the
// attestation uid (without its 0x) is the suffix.
export const buildGenericObject = (cfg: GoogleConfig, input: GooglePassInput): GoogleGenericObject => ({
  barcode: { alternateText: input.uid.slice(0, 10), type: 'QR_CODE', value: input.qr },
  cardTitle: localized('fuda membership'),
  classId: cfg.classId,
  header: localized(input.tierLabel),
  id: `${cfg.issuerId}.${input.uid.slice(2)}`,
  state: 'ACTIVE',
  textModulesData: [
    { body: input.tierLabel, header: 'Tier', id: 'tier' },
    { body: input.holderShort, header: 'Member', id: 'member' },
  ],
})

export interface GoogleJwtClaims {
  aud: string
  iat: number
  iss: string
  origins: string[]
  payload: { genericObjects: GoogleGenericObject[] }
  typ: string
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
export const signJwtRs256 = async (key: CryptoKey, claims: GoogleJwtClaims): Promise<string> => {
  const head = base64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = base64urlText(JSON.stringify(claims))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${base64urlBytes(new Uint8Array(sig))}`
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
