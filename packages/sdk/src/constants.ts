export type Hex = `0x${string}`

export const UID_RE = /^0x[0-9a-fA-F]{64}$/u
export const QR_PREFIX = 'fuda:v1:'
export const QR_RE = /^fuda:v1:(?<uid>0x[0-9a-fA-F]{64})$/u
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/u
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

// An offchain right has no holder address: its recipient is the zero address.
export const hasNoHolder = (holder: string): boolean => /^0x0{40}$/u.test(holder)

// An Identified or Sensitive pass: signed level with no holder address, so what it answers
// to is the key attested inside it (docs/specs/attestation-model.md#offchain-rights).
export const isPasskeyPass = (right: { holder: string; level: number }): boolean =>
  right.level === 1 && hasNoHolder(right.holder)

export const CHALLENGE_PREFIX = 'fuda-gate:'
export const CHALLENGE_TTL_SECONDS = 300

// The nonce is minted lowercase (docs/specs/attestation-model.md#wire-constants); a client may echo it upper-cased.
export const normalizeNonce = (s: string): Hex | null =>
  NONCE_RE.test(s) ? `0x${s.slice(2).toLowerCase()}` : null

// What the member signs (docs/specs/attestation-model.md#wire-constants): the plaintext challenge string, EIP-191 personal-sign.
export const challengeMessage = (uid: Hex, nonce: Hex, venue?: string): string =>
  venue === undefined
    ? `${CHALLENGE_PREFIX}${uid}:${nonce}`
    : `${CHALLENGE_PREFIX}${uid}:${nonce}:venue=${encodeURIComponent(venue)}`

export const toQr = (uid: Hex): string => `${QR_PREFIX}${uid}`

export const parseQr = (qr: string): Hex | null => {
  const captured = QR_RE.exec(qr)?.groups?.uid
  return captured === undefined ? null : normalizeUid(captured)
}

// level = the verification level a right was issued at (never "mode").
export type Level = 'bearer' | 'signed'
export const LEVEL_CODE = { bearer: 0, signed: 1 } as const satisfies Record<Level, number>

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
  'WRONG_VENUE',
  'BAD_CHALLENGE',
  'BAD_SIGNATURE',
  'REQUIREMENT_UNMET',
] as const
export type Reason = (typeof REASONS)[number]

export const BADGE_KINDS = ['human'] as const
export type BadgeKind = (typeof BADGE_KINDS)[number]

export const ERROR_CODES = [
  'bad_input',
  'bad_uid',
  'bad_qr',
  'client_ip_required',
  'unauthorized',
  'not_found',
  'rate_limited',
  'no_signer',
  'chain_error',
  'rpc_unavailable',
  'internal',
  'apple_not_configured',
  'google_not_configured',
  'bad_address',
  'bad_challenge',
  'bad_signature',
  'bad_passkey',
  'passkey_limit',
  'holder_must_claim',
  'last_passkey',
  'secret_conflict',
  'vault_conflict',
  'integrations_not_supported',
  'bad_handle',
  'handle_taken',
  // No longer returned: an account may own several issuers
  // (../../../docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route). Kept
  // so a client built against an older api still knows the code.
  'issuer_exists',
  'issuer_limit',
  'bad_slug',
  'slug_taken',
  'stamps_not_supported',
  'card_closed',
  'media_not_configured',
  'bad_upload',
  'upload_not_found',
  'ens_not_configured',
  'ens_persistence_failed',
  'already_claimed',
  'claim_failed',
  'claim_unconfirmed',
  'not_delegated',
  'already_badged',
  'pass_already_badged',
  'bad_proof',
  'badges_not_configured',
  // Connected apps (docs/specs/connected-apps.md). The first five are the
  // RFC 6749 token-endpoint codes, spelled as the RFC spells them.
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unsupported_grant_type',
  'invalid_scope',
  'insufficient_scope',
  'bad_redirect_uri',
  'not_app_owner',
  'app_limit',
  'requirement_unmet',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

// Every status an Issuer's pass list can show or be filtered by. Each is derived
// from the Issuer's local immutable issuance snapshot, revocation marker and
// default slot. This is not a fresh chain verdict.
export const ISSUER_PASS_STATUSES = [
  'active',
  'revoked',
  'expired',
  'not_yet_valid',
  'consumed',
  'unknown',
] as const
