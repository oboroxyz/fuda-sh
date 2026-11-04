import { env } from 'cloudflare:test'
import {
  concatHex,
  decodeAbiParameters,
  encodeFunctionData,
  isAddressEqual,
  keccak256,
  namehash,
  parseAbi,
  recoverAddress,
  toHex,
} from 'viem'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { packetToBytes } from 'viem/ens'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client.ts'
import { resolveGatewayRequest } from './gateway.ts'
import { ensNames } from './schema.ts'

const RESOLVER_SERVICE_ABI = parseAbi([
  'function resolve(bytes name, bytes data) view returns (bytes result, uint64 expires, bytes signature)',
])
const LEGACY_ADDR_ABI = parseAbi(['function addr(bytes32 node) view returns (address)'])
const MULTICOIN_ADDR_ABI = parseAbi(['function addr(bytes32 node, uint256 coinType) view returns (bytes)'])

const OWNER = `0x${'11'.repeat(20)}` as const
const TARGET = `0x${'22'.repeat(20)}` as const
const RESOLVER = `0x${'33'.repeat(20)}` as const
const SIGNER_KEY = `0x${'44'.repeat(32)}` as const

interface GatewayResponse {
  expires: bigint
  result: Hex
  signature: Hex
}

const gatewayRequest = (name: string, record: Hex): Hex =>
  encodeFunctionData({
    abi: RESOLVER_SERVICE_ABI,
    args: [toHex(packetToBytes(name)), record],
    functionName: 'resolve',
  })

const legacyAddrRequest = (name: string, node = namehash(name)): Hex =>
  gatewayRequest(name, encodeFunctionData({ abi: LEGACY_ADDR_ABI, args: [node], functionName: 'addr' }))

const multicoinAddrRequest = (name: string, coinType = 60n): Hex =>
  gatewayRequest(
    name,
    encodeFunctionData({
      abi: MULTICOIN_ADDR_ABI,
      args: [namehash(name), coinType],
      functionName: 'addr',
    }),
  )

const resolve = async (
  data: Hex,
  overrides: Partial<Parameters<typeof resolveGatewayRequest>[1]> = {},
): Promise<Hex | null> =>
  await resolveGatewayRequest(getDb({ DB: env.DB }), {
    data,
    now: 100,
    parentName: 'fuda.eth',
    resolverAddress: RESOLVER,
    responseTtl: 300,
    signerPrivateKey: SIGNER_KEY,
    ...overrides,
  })

const unpack = (response: Hex): GatewayResponse => {
  const [result, expires, signature] = decodeAbiParameters(
    [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
    response,
  )
  return { expires, result, signature }
}

const insertStable = async (name: string, expiry: number | null = null): Promise<void> => {
  await getDb({ DB: env.DB })
    .insert(ensNames)
    .values({
      createdAt: 1,
      expiry,
      issuerHandle: name.split('.')[0] ?? '',
      kind: 'issuer',
      name,
      ownerAddress: OWNER,
      status: 'offchain',
      targetAddress: TARGET,
      updatedAt: 1,
    })
}

describe('ENS CCIP-Read gateway protocol', () => {
  it('encodes the stable target for both ETH address record functions', async () => {
    const name = 'coffee.fuda.eth'
    await insertStable(name)

    const legacyResponse = await resolve(legacyAddrRequest(name))
    const multicoinResponse = await resolve(multicoinAddrRequest(name))

    if (legacyResponse === null || multicoinResponse === null) {
      throw new Error('expected gateway responses')
    }
    const legacy = unpack(legacyResponse)
    const multicoin = unpack(multicoinResponse)
    expect(decodeAbiParameters([{ type: 'address' }], legacy.result)[0]).toBe(TARGET)
    expect(decodeAbiParameters([{ type: 'bytes' }], multicoin.result)[0]).toBe(TARGET)
  })

  it('signs a response bound to the resolver, expiry, complete request, and result', async () => {
    const name = 'bakery.fuda.eth'
    await insertStable(name, 250)
    const request = legacyAddrRequest(name)

    const response = await resolve(request)

    if (response === null) {
      throw new Error('expected gateway response')
    }
    const { expires, result, signature } = unpack(response)
    const digest = keccak256(
      concatHex(['0x1900', RESOLVER, toHex(expires, { size: 8 }), keccak256(request), keccak256(result)]),
    )
    const recovered = await recoverAddress({ hash: digest, signature })
    expect(expires).toBe(250n)
    expect(isAddressEqual(recovered, privateKeyToAccount(SIGNER_KEY).address)).toBe(true)
  })

  it('rejects a record whose node is not the DNS namehash', async () => {
    const name = 'gallery.fuda.eth'
    await insertStable(name)

    await expect(resolve(legacyAddrRequest(name, namehash('other.fuda.eth')))).rejects.toThrow(
      'record node does not match name',
    )
  })

  it.each([
    ['unsupported selector', gatewayRequest('club.fuda.eth', '0x12345678'), 'unsupported resolver record'],
    ['unsupported coin type', multicoinAddrRequest('club.fuda.eth', 0n), 'unsupported coin type'],
    [
      'unterminated DNS name',
      encodeFunctionData({
        abi: RESOLVER_SERVICE_ABI,
        args: ['0x04636c756203657468', legacyAddrRequest('club.fuda.eth')],
        functionName: 'resolve',
      }),
      'unterminated DNS name',
    ],
  ])('rejects an %s request without resolving it', async (_case, request, message) => {
    await expect(resolve(request)).rejects.toThrow(message)
  })

  it('returns null for an unknown canonical name', async () => {
    await expect(resolve(legacyAddrRequest('unknown.fuda.eth'))).resolves.toBeNull()
  })

  it('rejects an invalid signer key', async () => {
    await expect(
      resolve(legacyAddrRequest('unknown.fuda.eth'), { signerPrivateKey: '0x1234' }),
    ).rejects.toThrow('invalid ENS gateway signer key')
  })
})
