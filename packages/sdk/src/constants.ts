export type Hex = `0x${string}`

export const UID_RE = /^0x[0-9a-fA-F]{64}$/u
export const QR_PREFIX = 'fuda:v1:'
export const QR_RE = /^fuda:v1:(?<uid>0x[0-9a-fA-F]{64})$/u
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/u
export const META_ADDRESS_RE = /^0x[0-9a-fA-F]{132}$/u
export const NONCE_RE = /^0x[0-9a-fA-F]{32}$/u
export const SIGNATURE_RE = /^0x[0-9a-fA-F]+$/u

export const isUid = (s: string): s is Hex => UID_RE.test(s)

// The canonical form of a uid: EAS and D1 both hold it lowercase, so an
// upper-case uid from a QR reader or a pasted URL must be folded once, at the
// edge, or it silently misses every row it names. Annotated (not cast): the
// template literal is contextually typed as Hex.
export const normalizeUid = (s: string): Hex | null => (isUid(s) ? `0x${s.slice(2).toLowerCase()}` : null)

// Validated hex of an exact byte length. Annotated (not cast): the regex
// guarantees the 0x prefix, so the template literal narrows to Hex. Case is
// preserved — addresses keep their EIP-55 checksum, uids are folded by
// normalizeUid separately.
export const asHex = (s: string, bytes: number): Hex | null => {
  const re = new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`, 'u')
  return re.test(s) ? `0x${s.slice(2)}` : null
}

export const CHALLENGE_PREFIX = 'fuda-gate:'
export const CHALLENGE_TTL_SECONDS = 300

// The nonce is minted lowercase (§3); a client may echo it upper-cased.
export const normalizeNonce = (s: string): Hex | null =>
  NONCE_RE.test(s) ? `0x${s.slice(2).toLowerCase()}` : null

// What the member signs (§5): the plaintext challenge string, EIP-191 personal-sign.
export const challengeMessage = (uid: Hex, nonce: Hex): string => `${CHALLENGE_PREFIX}${uid}:${nonce}`

export const toQr = (uid: Hex): string => `${QR_PREFIX}${uid}`

export const parseQr = (qr: string): Hex | null => {
  const captured = QR_RE.exec(qr)?.groups?.uid
  return captured === undefined ? null : normalizeUid(captured)
}

// level = the verification level a right was issued at (never "mode").
export type Level = 'bearer' | 'signed' | 'private'
export const LEVEL_CODE = { bearer: 0, private: 2, signed: 1 } as const satisfies Record<Level, number>
export type LevelCode = (typeof LEVEL_CODE)[Level]
const LEVELS: readonly Level[] = ['bearer', 'signed', 'private']
export const levelFromCode = (code: number): Level | null => LEVELS[code] ?? null

// path = how an entry was made (never the right's level).
export type EntryPath = 'qr' | 'signature'

// UsageModel: SINGLE_USE | MULTI_USE | METERED
export type UsageModel = 0 | 1 | 2
export const USAGE_MODEL = { METERED: 2, MULTI_USE: 1, SINGLE_USE: 0 } as const
// Tier: FREE | REGULAR | VIP | FOUNDER
export type Tier = 0 | 1 | 2 | 3
export const TIER_LABEL = ['FREE', 'REGULAR', 'VIP', 'FOUNDER'] as const

export const REASONS = [
  'OK',
  'NOT_FOUND',
  'WRONG_SCHEMA',
  'REVOKED',
  'UNKNOWN_USAGE_MODEL',
  'NOT_YET_VALID',
  'EXPIRED',
  'NO_DELEGATION',
  'ISSUER_NOT_DELEGATED',
  'DELEGATION_UNAVAILABLE',
  'DELEGATION_CONFIG_MISSING',
  'LEVEL_REQUIRED',
  'ALREADY_USED',
  'BAD_CHALLENGE',
  'BAD_SIGNATURE',
] as const
export type Reason = (typeof REASONS)[number]

export const ERROR_CODES = [
  'bad_input',
  'bad_uid',
  'bad_qr',
  'bad_meta_address',
  'client_ip_required',
  'unauthorized',
  'not_found',
  'rate_limited',
  'no_signer',
  'chain_error',
  'rpc_unavailable',
  'apple_not_configured',
  'google_not_configured',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
