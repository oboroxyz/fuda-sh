// The member number (docs/specs/ens-naming.md#member-number): 12 random
// characters from a 28-character confusable-free alphabet plus one Luhn mod 28
// check character. Canonical form is lowercase with no separators; the pass
// shows it upper-cased in 4-4-5 groups.
export const MEMBER_NUMBER_ALPHABET = '23456789acdefghjkmnpqrtuvwxy'
export const MEMBER_NUMBER_LENGTH = 13
const PAYLOAD_LENGTH = MEMBER_NUMBER_LENGTH - 1
const RADIX = MEMBER_NUMBER_ALPHABET.length

const checkIndex = (payload: string): number => {
  let factor = 2
  let sum = 0
  for (let index = payload.length - 1; index >= 0; index -= 1) {
    const value = MEMBER_NUMBER_ALPHABET.indexOf(payload.charAt(index))
    if (value === -1) {
      return -1
    }
    const product = value * factor
    sum += Math.floor(product / RADIX) + (product % RADIX)
    factor = factor === 2 ? 1 : 2
  }
  return (RADIX - (sum % RADIX)) % RADIX
}

export const isMemberNumber = (raw: string): boolean => {
  if (raw.length !== MEMBER_NUMBER_LENGTH) {
    return false
  }
  return MEMBER_NUMBER_ALPHABET[checkIndex(raw.slice(0, -1))] === raw.at(-1)
}

export type RandomBytes = (length: number) => Uint8Array

const cryptoRandom: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length))

// Rejection sampling keeps every alphabet character equally likely: a byte is
// used only when it falls under the largest multiple of 28 that fits in 256.
export const generateMemberNumber = (random: RandomBytes = cryptoRandom): string => {
  const limit = Math.floor(256 / RADIX) * RADIX
  let payload = ''
  while (payload.length < PAYLOAD_LENGTH) {
    for (const byte of random(PAYLOAD_LENGTH)) {
      if (byte < limit && payload.length < PAYLOAD_LENGTH) {
        payload += MEMBER_NUMBER_ALPHABET.charAt(byte % RADIX)
      }
    }
  }
  return `${payload}${MEMBER_NUMBER_ALPHABET.charAt(checkIndex(payload))}`
}

// Display form: `QJ2Y-XPHE-PDRKA`. Anything that is not a member number is
// returned unchanged, so a free-text admin memberId still renders as typed.
export const formatMemberNumber = (raw: string): string => {
  if (!isMemberNumber(raw)) {
    return raw
  }
  const upper = raw.toUpperCase()
  return `${upper.slice(0, 4)}-${upper.slice(4, 8)}-${upper.slice(8)}`
}
