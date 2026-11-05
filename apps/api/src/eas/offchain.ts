import * as v from 'valibot'
import {
  bytesToHex,
  decodeAbiParameters,
  encodeAbiParameters,
  encodePacked,
  hexToBytes,
  isHex,
  keccak256,
  parseAbiParameters,
  recoverTypedDataAddress,
  size,
  stringToHex,
  zeroAddress,
} from 'viem'
import type { Hex } from 'viem'

import { base64UrlOf, bytesOfBase64Url } from '../base64url.ts'
import { schemaUid } from './schemas.ts'

// docs/specs/attestation-model.md#offchain-rights. The schema needs no entry in
// EAS_SCHEMAS: EAS never sees it at signing, and its uid is a pure function of
// this string. `holderKey` is empty for a Bearer right, an encoded AttestedPasskey for an
// Identified one, and a key's 20-byte address for a Sensitive one.
const OFFCHAIN_PASS_SCHEMA =
  'string venue,string card,string memberNumber,uint8 usageModel,uint8 tier,uint8 level,uint64 validFrom,uint64 validUntil,bytes holderKey'
export const OFFCHAIN_PASS_SCHEMA_UID = schemaUid(OFFCHAIN_PASS_SCHEMA)

const PASS_PARAMS = parseAbiParameters(OFFCHAIN_PASS_SCHEMA)

export interface OffchainPassData {
  venue: string
  card: string
  memberNumber: string
  usageModel: number
  tier: number
  level: number
  validFrom: bigint
  validUntil: bigint
  holderKey: Hex
}

export const encodeOffchainPass = (p: OffchainPassData): Hex =>
  encodeAbiParameters(PASS_PARAMS, [
    p.venue,
    p.card,
    p.memberNumber,
    p.usageModel,
    p.tier,
    p.level,
    p.validFrom,
    p.validUntil,
    p.holderKey,
  ])

export const decodeOffchainPass = (data: Hex): OffchainPassData => {
  const [venue, card, memberNumber, usageModel, tier, level, validFrom, validUntil, holderKey] =
    decodeAbiParameters(PASS_PARAMS, data)
  return { card, holderKey, level, memberNumber, tier, usageModel, validFrom, validUntil, venue }
}

// What an Identified pass answers to, in `holderKey`: enough for a gate to check an
// assertion with nothing else. `credentialId` is base64url, as WebAuthn's JSON has it, and
// `publicKey` is the COSE key the passkey registered.
export interface AttestedPasskey {
  credentialId: string
  publicKey: Hex
}

const HOLDER_KEY_PARAMS = parseAbiParameters('bytes credentialId, bytes publicKey')

export const encodeHolderKey = (key: AttestedPasskey): Hex =>
  encodeAbiParameters(HOLDER_KEY_PARAMS, [bytesToHex(bytesOfBase64Url(key.credentialId)), key.publicKey])

// null for a Bearer pass's empty key, and for one that does not decode, which then
// matches no assertion.
export const decodeHolderKey = (holderKey: Hex): AttestedPasskey | null => {
  try {
    const [credentialId, publicKey] = decodeAbiParameters(HOLDER_KEY_PARAMS, holderKey)
    return { credentialId: base64UrlOf(hexToBytes(credentialId)), publicKey }
  } catch {
    return null
  }
}

// A Sensitive pass's `holderKey`. Its length alone tells it from an encoded passkey, whose
// two dynamic fields take at least 128 bytes.
export const holderAddressOf = (holderKey: Hex): Hex | null => (size(holderKey) === 20 ? holderKey : null)

// EAS offchain attestation version 2, the form that carries a salt.
const ATTEST_VERSION = 2

const ATTEST_TYPES = {
  Attest: [
    { name: 'version', type: 'uint16' },
    { name: 'schema', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'time', type: 'uint64' },
    { name: 'expirationTime', type: 'uint64' },
    { name: 'revocable', type: 'bool' },
    { name: 'refUID', type: 'bytes32' },
    { name: 'data', type: 'bytes' },
    { name: 'salt', type: 'bytes32' },
  ],
} as const

export interface OffchainDomain {
  name: 'EAS Attestation'
  version: string
  chainId: number
  verifyingContract: Hex
}

export interface OffchainMessage {
  version: number
  schema: Hex
  recipient: Hex
  time: bigint
  expirationTime: bigint
  revocable: boolean
  refUID: Hex
  data: Hex
  salt: Hex
}

// Everything a signer needs. `chainId` must reach viem as a bigint-safe number:
// a string recovers a different address without any error.
export const offchainTypedData = (domain: OffchainDomain, message: OffchainMessage) => ({
  domain: { ...domain, chainId: BigInt(domain.chainId) },
  message: { ...message, version: message.version },
  primaryType: 'Attest' as const,
  types: ATTEST_TYPES,
})

export type OffchainTypedData = ReturnType<typeof offchainTypedData>

// EAS's own derivation: the schema enters as the UTF-8 bytes of its hex string,
// and the attester slot is always zero, so a uid does not name its signer.
export const offchainUid = (m: OffchainMessage): Hex =>
  keccak256(
    encodePacked(
      [
        'uint16',
        'bytes',
        'address',
        'address',
        'uint64',
        'uint64',
        'bool',
        'bytes32',
        'bytes',
        'bytes32',
        'uint32',
      ],
      [
        m.version,
        stringToHex(m.schema),
        m.recipient,
        zeroAddress,
        m.time,
        m.expirationTime,
        m.revocable,
        m.refUID,
        m.data,
        m.salt,
        0,
      ],
    ),
  )

export const newOffchainMessage = (p: {
  data: Hex
  expirationTime: bigint
  refUID: Hex
  time: bigint
}): OffchainMessage => ({
  data: p.data,
  expirationTime: p.expirationTime,
  recipient: zeroAddress,
  refUID: p.refUID,
  revocable: true,
  salt: `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')}`,
  schema: OFFCHAIN_PASS_SCHEMA_UID,
  time: p.time,
  version: ATTEST_VERSION,
})

// The stored and exportable form. Integers that overflow JSON numbers are decimal
// strings; `fromSignedJson` turns them back before anything hashes them.
export interface SignedOffchain {
  domain: OffchainDomain
  message: OffchainMessage
  signature: Hex
  uid: Hex
}

export const toSignedJson = (s: SignedOffchain): string =>
  JSON.stringify({
    domain: s.domain,
    message: { ...s.message, expirationTime: String(s.message.expirationTime), time: String(s.message.time) },
    signature: s.signature,
    uid: s.uid,
  })

const HexString = v.custom<Hex>((value) => isHex(value))
const Decimal = v.pipe(v.string(), v.regex(/^\d+$/u))

const SignedJson = v.object({
  domain: v.object({
    chainId: v.number(),
    name: v.literal('EAS Attestation'),
    verifyingContract: HexString,
    version: v.string(),
  }),
  message: v.object({
    data: HexString,
    expirationTime: Decimal,
    recipient: HexString,
    refUID: HexString,
    revocable: v.boolean(),
    salt: HexString,
    schema: HexString,
    time: Decimal,
    version: v.number(),
  }),
  signature: HexString,
  uid: HexString,
})

const parseSignedJson = (json: string) => {
  try {
    const parsed = v.safeParse(SignedJson, JSON.parse(json))
    return parsed.success ? parsed.output : null
  } catch {
    return null
  }
}

// The stored form as it is, for a holder keeping their own copy.
export const signedJsonOf = (json: string): v.InferOutput<typeof SignedJson> | null => parseSignedJson(json)

// null for a row that does not parse: the gate answers that as a decision.
export const fromSignedJson = (json: string): SignedOffchain | null => {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  const parsed = v.safeParse(SignedJson, raw)
  if (!parsed.success) {
    return null
  }
  const { domain, message, signature, uid } = parsed.output
  return {
    domain,
    message: { ...message, expirationTime: BigInt(message.expirationTime), time: BigInt(message.time) },
    signature,
    uid,
  }
}

// The address that signed, or null for a signature that recovers to nothing.
export const recoverOffchainSigner = async (s: SignedOffchain): Promise<Hex | null> => {
  try {
    return await recoverTypedDataAddress({
      ...offchainTypedData(s.domain, s.message),
      signature: s.signature,
    })
  } catch {
    return null
  }
}
