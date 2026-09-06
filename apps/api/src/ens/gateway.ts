import {
  concatHex,
  decodeFunctionData,
  encodeAbiParameters,
  hexToBytes,
  isAddress,
  isHex,
  keccak256,
  namehash,
  parseAbi,
  toHex,
} from 'viem'
import type { Address, Hex, PrivateKeyAccount } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import type { Db } from '../db/client.ts'
import { lookupEnsName } from './lookup.ts'
import { issuerEnsName, memberEnsName, parseFudaEnsName } from './names.ts'
import { allocateStealthResolution, assertGatewaySecret } from './resolution.ts'

const RESOLVER_SERVICE_ABI = parseAbi([
  'function resolve(bytes name, bytes data) view returns (bytes result, uint64 expires, bytes signature)',
])
const LEGACY_ADDR_ABI = parseAbi(['function addr(bytes32 node) view returns (address)'])
const MULTICOIN_ADDR_ABI = parseAbi(['function addr(bytes32 node, uint256 coinType) view returns (bytes)'])
const LEGACY_ADDR_SELECTOR = '0x3b3b57de'
const MULTICOIN_ADDR_SELECTOR = '0xf1cb7e06'
const ETH_COIN_TYPE = 60n
const DEFAULT_RESPONSE_TTL = 300
const MAX_UINT64 = 0xff_ff_ff_ff_ff_ff_ff_ffn
const PRIVATE_KEY = /^0x[0-9a-f]{64}$/iu

export class EnsGatewayError extends Error {
  readonly kind: 'config' | 'request'
  override name = 'EnsGatewayError'

  constructor(message: string, kind: 'config' | 'request') {
    super(message)
    this.kind = kind
  }
}

interface ResolveGatewayInput {
  data: Hex
  gatewaySecret: string
  now: number
  parentName: string
  resolverAddress: Address
  responseTtl?: number
  signerPrivateKey: string
}

interface ParsedRequest {
  canonicalName: string
  record: Hex
  recordKind: 'legacy' | 'multicoin'
}

const invalidRequest = (message: string): never => {
  throw new EnsGatewayError(message, 'request')
}

const decodeDnsName = (encoded: Hex): string => {
  const bytes = hexToBytes(encoded)
  const labels: string[] = []
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let offset = 0
  while (offset < bytes.length) {
    const length = bytes[offset]
    offset += 1
    if (length === undefined) {
      invalidRequest('malformed DNS name')
    }
    if (length === 0) {
      if (offset !== bytes.length || labels.length === 0) {
        invalidRequest('malformed DNS name')
      }
      return labels.join('.')
    }
    if (length > 63 || offset + length > bytes.length) {
      invalidRequest('malformed DNS name')
    }
    try {
      labels.push(decoder.decode(bytes.subarray(offset, offset + length)))
    } catch {
      invalidRequest('malformed DNS name')
    }
    offset += length
  }
  return invalidRequest('unterminated DNS name')
}

const canonicalName = (name: string, parentName: string): string | null => {
  const parsed = parseFudaEnsName(name, parentName)
  if (parsed === null) {
    return null
  }
  return parsed.kind === 'issuer'
    ? issuerEnsName(parsed.issuerHandle, parentName)
    : memberEnsName(parsed.memberNumber, parsed.issuerHandle, parentName)
}

const parseRecord = (record: Hex, canonical: string): Pick<ParsedRequest, 'recordKind'> => {
  const selector = record.slice(0, 10)
  if (selector === LEGACY_ADDR_SELECTOR) {
    try {
      const decoded = decodeFunctionData({ abi: LEGACY_ADDR_ABI, data: record })
      if (decoded.args[0] !== namehash(canonical)) {
        invalidRequest('record node does not match name')
      }
      return { recordKind: 'legacy' }
    } catch (error) {
      if (error instanceof EnsGatewayError) {
        throw error
      }
      return invalidRequest('malformed addr request')
    }
  }
  if (selector === MULTICOIN_ADDR_SELECTOR) {
    try {
      const decoded = decodeFunctionData({ abi: MULTICOIN_ADDR_ABI, data: record })
      if (decoded.args[0] !== namehash(canonical)) {
        invalidRequest('record node does not match name')
      }
      if (decoded.args[1] !== ETH_COIN_TYPE) {
        invalidRequest('unsupported coin type')
      }
      return { recordKind: 'multicoin' }
    } catch (error) {
      if (error instanceof EnsGatewayError) {
        throw error
      }
      return invalidRequest('malformed addr request')
    }
  }
  return invalidRequest('unsupported resolver record')
}

const parseRequest = (data: Hex, parentName: string): ParsedRequest | null => {
  let encodedName: Hex
  let record: Hex
  try {
    const decoded = decodeFunctionData({ abi: RESOLVER_SERVICE_ABI, data })
    ;[encodedName, record] = decoded.args
  } catch {
    return invalidRequest('malformed gateway request')
  }
  const canonical = canonicalName(decodeDnsName(encodedName), parentName)
  if (canonical === null) {
    return null
  }
  return { canonicalName: canonical, record, ...parseRecord(record, canonical) }
}

const signerAccount = (privateKey: string): PrivateKeyAccount => {
  if (!PRIVATE_KEY.test(privateKey) || !isHex(privateKey)) {
    throw new EnsGatewayError('invalid ENS gateway signer key', 'config')
  }
  try {
    return privateKeyToAccount(privateKey)
  } catch {
    throw new EnsGatewayError('invalid ENS gateway signer key', 'config')
  }
}

const responseExpiry = (input: ResolveGatewayInput, nameExpiry: number | null): number => {
  const ttl = input.responseTtl ?? DEFAULT_RESPONSE_TTL
  if (!Number.isSafeInteger(input.now) || input.now < 0 || !Number.isSafeInteger(ttl) || ttl <= 0) {
    throw new EnsGatewayError('invalid ENS gateway response lifetime', 'config')
  }
  const expires = Math.min(input.now + ttl, nameExpiry ?? Number.MAX_SAFE_INTEGER)
  if (!Number.isSafeInteger(expires) || BigInt(expires) > MAX_UINT64) {
    throw new EnsGatewayError('invalid ENS gateway response lifetime', 'config')
  }
  return expires
}

const encodeRecordResult = (kind: ParsedRequest['recordKind'], address: Address): Hex =>
  kind === 'legacy'
    ? encodeAbiParameters([{ type: 'address' }], [address])
    : encodeAbiParameters([{ type: 'bytes' }], [address])

export const gatewaySignatureHash = (input: {
  expires: number | bigint
  request: Hex
  resolverAddress: Address
  result: Hex
}): Hex =>
  keccak256(
    concatHex([
      '0x1900',
      input.resolverAddress,
      toHex(BigInt(input.expires), { size: 8 }),
      keccak256(input.request),
      keccak256(input.result),
    ]),
  )

export const resolveGatewayRequest = async (db: Db, input: ResolveGatewayInput): Promise<Hex | null> => {
  const account = signerAccount(input.signerPrivateKey)
  try {
    assertGatewaySecret(input.gatewaySecret)
  } catch {
    throw new EnsGatewayError('invalid ENS gateway allocation secret', 'config')
  }
  const request = parseRequest(input.data, input.parentName)
  if (request === null) {
    return null
  }
  const lookup = await lookupEnsName(db, {
    name: request.canonicalName,
    now: input.now,
    parentName: input.parentName,
  })
  if (lookup === null) {
    return null
  }
  const expires = responseExpiry(input, lookup.expiresAt)
  let address: Hex | undefined
  if (lookup.type === 'address') {
    const { address: stableAddress } = lookup
    address = stableAddress
  } else {
    const allocation = await allocateStealthResolution(db, {
      ensNameId: lookup.ensNameId,
      expiresAt: expires,
      gatewaySecret: input.gatewaySecret,
      name: request.canonicalName,
      now: input.now,
    })
    address = allocation?.stealthAddress
  }
  if (address === undefined || !isAddress(address, { strict: true })) {
    return null
  }
  const result = encodeRecordResult(request.recordKind, address)
  const signature = await account.sign({
    hash: gatewaySignatureHash({
      expires,
      request: input.data,
      resolverAddress: input.resolverAddress,
      result,
    }),
  })
  return encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
    [result, BigInt(expires), signature],
  )
}
