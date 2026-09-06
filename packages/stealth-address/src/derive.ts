import { secp256k1 } from '@noble/curves/secp256k1'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import type { Hex } from 'viem'

import { INFO_MEMBER_SECRET, INFO_SPEND, INFO_VIEW, SALT } from './constants.ts'

export interface StealthKeys {
  spendPriv: Uint8Array
  viewPriv: Uint8Array
  spendPub: Hex
  viewPub: Hex
  metaAddress: Hex
}

const N = secp256k1.CURVE.n

// Annotated (not cast): a hex string with the 0x prefix is contextually typed as Hex.
const toHex = (bytes: Uint8Array): Hex => `0x${bytesToHex(bytes)}`

const bytesToBigInt = (bytes: Uint8Array): bigint => BigInt(`0x${bytesToHex(bytes)}`)

// A uniformly random 32-byte string folded into [1, N-1], so the scalar is
// always a valid private key.
const toScalar = (bytes: Uint8Array): bigint => (bytesToBigInt(bytes) % (N - 1n)) + 1n

const scalarToBytes = (k: bigint): Uint8Array => {
  const hex = k.toString(16).padStart(64, '0')
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

// The convergence point of every derivation source (docs/specs/pass-types-and-flows.md#u2-privacy-first-issuance): the PRF output today,
// keccak256(personal_sign('fuda.sh/stealth/eoa/v1')) if the EOA source is ever built.
export const deriveMemberSecret = (entropy: Uint8Array): Uint8Array =>
  hkdf(sha256, entropy, SALT, INFO_MEMBER_SECRET, 32)

export const deriveStealthKeys = (memberSecret: Uint8Array): StealthKeys => {
  const spendPriv = scalarToBytes(toScalar(hkdf(sha256, memberSecret, SALT, INFO_SPEND, 32)))
  const viewPriv = scalarToBytes(toScalar(hkdf(sha256, memberSecret, SALT, INFO_VIEW, 32)))
  const spendPub = toHex(secp256k1.getPublicKey(spendPriv, true))
  const viewPub = toHex(secp256k1.getPublicKey(viewPriv, true))
  return { metaAddress: `${spendPub}${viewPub.slice(2)}`, spendPriv, spendPub, viewPriv, viewPub }
}
