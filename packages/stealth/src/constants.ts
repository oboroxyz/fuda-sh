// Every string here is a wire constant (spec §5, §7): changing one changes
// every meta-address ever derived, so none may be edited in place.
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

export const SALT: Uint8Array = utf8('fuda.sh/stealth/v1')
export const INFO_MEMBER_SECRET: Uint8Array = utf8('member-secret')
export const INFO_SPEND: Uint8Array = utf8('stealth-spend')
export const INFO_VIEW: Uint8Array = utf8('stealth-view')

// The WebAuthn PRF eval input (§5). The PRF output is a function of this input,
// so it must never change.
export const PRF_EVAL_INPUT = 'fuda.sh/stealth/prf/v1'

// ERC-5564 scheme 1: secp256k1 with view tags.
export const SCHEME_ID = 1

// 0x + viewTag (1 byte) + uid (32 bytes)
export const METADATA_RE = /^0x[0-9a-fA-F]{66}$/u
