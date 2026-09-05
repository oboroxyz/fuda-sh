import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils'
import type { Hex } from 'viem'
import { publicKeyToAddress } from 'viem/accounts'

import type { StealthKeys } from './derive.ts'
import { parseAnnouncementMetadata } from './metadata.ts'

const N = secp256k1.CURVE.n
const META_RE = /^0x[0-9a-fA-F]{132}$/u

const toHex = (bytes: Uint8Array): Hex => `0x${bytesToHex(bytes)}`
const fromHex = (h: Hex): Uint8Array => hexToBytes(h.slice(2))
const bytesToBigInt = (bytes: Uint8Array): bigint => BigInt(`0x${bytesToHex(bytes)}`)

const scalarToBytes = (k: bigint): Uint8Array => hexToBytes(k.toString(16).padStart(64, '0'))

// The hash-to-scalar step. A zero tweak would make the stealth key equal the
// spend key — degenerate by definition, and astronomically unlikely — so it is
// refused rather than used. Exported so that refusal is testable directly: no
// keccak preimage hashing to a multiple of N is reachable by construction.
export const tweakFromShared = (shared: Uint8Array): bigint => {
  const tweak = bytesToBigInt(shared) % N
  if (tweak === 0n) {
    throw new Error('degenerate stealth tweak')
  }
  return tweak
}

interface SharedSecret {
  shared: Uint8Array
  tweak: bigint
}

// shared = keccak256(compressed ECDH point); the tweak is that hash as a scalar.
const sharedSecret = (priv: Uint8Array, pub: Uint8Array): SharedSecret => {
  const point = secp256k1.getSharedSecret(priv, pub, true)
  const shared = keccak_256(point)
  return { shared, tweak: tweakFromShared(shared) }
}

interface MetaAddressParts {
  spendPub: Uint8Array
  viewPub: Uint8Array
}

// Both failure modes throw on the same `malformed meta-address` prefix, so a caller
// (the api at /issue) maps one prefix to one 400 rather than matching noble's internals.
const splitMeta = (metaAddress: string): MetaAddressParts => {
  if (!META_RE.test(metaAddress)) {
    throw new Error('malformed meta-address: expected 0x followed by 132 hex characters')
  }
  const body = metaAddress.slice(2)
  const spendPub = hexToBytes(body.slice(0, 66))
  const viewPub = hexToBytes(body.slice(66))
  // The shape alone is not enough: a well-formed 132-hex string can still carry a
  // bad prefix byte or an off-curve x. Without this, the failure surfaces deep
  // inside noble at ECDH time with a message the caller cannot attribute.
  try {
    secp256k1.ProjectivePoint.fromHex(spendPub)
    secp256k1.ProjectivePoint.fromHex(viewPub)
  } catch {
    throw new Error('malformed meta-address: both halves must be compressed secp256k1 points')
  }
  return { spendPub, viewPub }
}

// A throw-free pre-check for callers that need to reject a bad meta-address before
// doing any work (the api at /issue answers 400 bad_meta_address from this).
export const isMetaAddress = (hex: string): boolean => {
  try {
    splitMeta(hex)
    return true
  } catch {
    return false
  }
}

// The uncompressed 65-byte form viem's publicKeyToAddress expects.
const addressOf = (compressed: Uint8Array): Hex =>
  publicKeyToAddress(toHex(secp256k1.ProjectivePoint.fromHex(compressed).toRawBytes(false)))

// spendPub + G * tweak, compressed.
const tweakedSpendPub = (spendPub: Uint8Array, tweak: bigint): Uint8Array =>
  secp256k1.ProjectivePoint.fromHex(spendPub)
    .add(secp256k1.ProjectivePoint.BASE.multiply(tweak))
    .toRawBytes(true)

export interface GeneratedStealthAddress {
  stealthAddress: Hex
  ephemeralPublicKey: Hex
  viewTag: number
}

// Sender side (the api at /issue): a fresh ephemeral key per right.
export const generateStealthAddress = (
  metaAddress: Hex,
  ephemeralPriv: Uint8Array = randomBytes(32),
): GeneratedStealthAddress => {
  const { spendPub, viewPub } = splitMeta(metaAddress)
  const { shared, tweak } = sharedSecret(ephemeralPriv, viewPub)
  return {
    ephemeralPublicKey: toHex(secp256k1.getPublicKey(ephemeralPriv, true)),
    stealthAddress: addressOf(tweakedSpendPub(spendPub, tweak)),
    viewTag: shared[0],
  }
}

export interface AnnouncementRow {
  stealthAddress: Hex
  ephemeralPubKey: Hex
  metadata: Hex
}

// Receiver side. The view tag is byte 0 of the ECDH-derived shared secret, so the
// ECDH cannot be skipped — it runs first. The tag then gates the expensive half
// (the tweak multiplication, the point addition and the address derivation),
// rejecting 255/256 of foreign announcements before any of it.
export const checkAnnouncement = (keys: StealthKeys, a: AnnouncementRow): boolean => {
  const meta = parseAnnouncementMetadata(a.metadata)
  if (meta === null) {
    return false
  }
  let derived: SharedSecret
  try {
    derived = sharedSecret(keys.viewPriv, fromHex(a.ephemeralPubKey))
  } catch {
    return false
  }
  if (derived.shared[0] !== meta.viewTag) {
    return false
  }
  const stealthPub = tweakedSpendPub(fromHex(keys.spendPub), derived.tweak)
  return addressOf(stealthPub).toLowerCase() === a.stealthAddress.toLowerCase()
}

export const recoverStealthPrivateKey = (keys: StealthKeys, ephemeralPublicKey: Hex): Hex => {
  const { tweak } = sharedSecret(keys.viewPriv, fromHex(ephemeralPublicKey))
  const key = (bytesToBigInt(keys.spendPriv) + tweak) % N
  return toHex(scalarToBytes(key))
}

export interface DiscoveredPass {
  uid: Hex
  stealthAddress: Hex
  stealthPrivateKey: Hex
}

export const matchAnnouncements = (keys: StealthKeys, rows: AnnouncementRow[]): DiscoveredPass[] =>
  rows.flatMap((row) => {
    if (!checkAnnouncement(keys, row)) {
      return []
    }
    const meta = parseAnnouncementMetadata(row.metadata)
    if (meta === null) {
      return []
    }
    return [
      {
        stealthAddress: row.stealthAddress,
        stealthPrivateKey: recoverStealthPrivateKey(keys, row.ephemeralPubKey),
        uid: meta.uid,
      },
    ]
  })
