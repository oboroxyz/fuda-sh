import { deriveMemberSecret, deriveStealthKeys } from '@fuda/stealth-address'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
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
import { ensNames, stealthResolutions } from './schema.ts'

const RESOLVER_SERVICE_ABI = parseAbi([
  'function resolve(bytes name, bytes data) view returns (bytes result, uint64 expires, bytes signature)',
])
const LEGACY_ADDR_ABI = parseAbi(['function addr(bytes32 node) view returns (address)'])
const MULTICOIN_ADDR_ABI = parseAbi(['function addr(bytes32 node, uint256 coinType) view returns (bytes)'])

const OWNER = `0x${'11'.repeat(20)}` as const
const TARGET = `0x${'22'.repeat(20)}` as const
const RESOLVER = `0x${'33'.repeat(20)}` as const
const SIGNER_KEY = `0x${'44'.repeat(32)}` as const
const GATEWAY_SECRET = `0x${'55'.repeat(32)}` as const
const META_ADDRESS = deriveStealthKeys(deriveMemberSecret(new Uint8Array(32).fill(9))).metaAddress

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
    gatewaySecret: GATEWAY_SECRET,
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

  it('allocates and records a distinct destination for each +Private request', async () => {
    const db = getDb({ DB: env.DB })
    const name = '23456789acded.coffee.fuda.eth'
    await db.insert(ensNames).values({
      createdAt: 1,
      expiry: 500,
      issuerHandle: 'coffee',
      kind: 'member',
      level: 'private',
      name,
      ownerAddress: OWNER,
      rightUid: `0x${'66'.repeat(32)}`,
      status: 'offchain',
      stealthMetaAddress: META_ADDRESS,
      updatedAt: 1,
    })

    const [firstResponse, secondResponse] = await Promise.all([
      resolve(legacyAddrRequest(name)),
      resolve(legacyAddrRequest(name)),
    ])

    if (firstResponse === null || secondResponse === null) {
      throw new Error('expected private gateway responses')
    }
    const [first] = decodeAbiParameters([{ type: 'address' }], unpack(firstResponse).result)
    const [second] = decodeAbiParameters([{ type: 'address' }], unpack(secondResponse).result)
    expect(first).not.toBe(second)
    const rows = await db.select().from(stealthResolutions)
    expect(rows.map((row) => ({ expiresAt: row.expiresAt, nonceCounter: row.nonceCounter }))).toStrictEqual([
      { expiresAt: 400, nonceCounter: 0 },
      { expiresAt: 400, nonceCounter: 1 },
    ])
  })

  it('validates both secrets before consuming a private counter', async () => {
    const db = getDb({ DB: env.DB })
    const name = '3456789acdefq.club.fuda.eth'
    const [inserted] = await db
      .insert(ensNames)
      .values({
        createdAt: 1,
        issuerHandle: 'club',
        kind: 'member',
        level: 'private',
        name,
        ownerAddress: OWNER,
        rightUid: `0x${'77'.repeat(32)}`,
        status: 'offchain',
        stealthMetaAddress: META_ADDRESS,
        updatedAt: 1,
      })
      .returning({ id: ensNames.id })

    await expect(resolve(legacyAddrRequest(name), { signerPrivateKey: '0x1234' })).rejects.toThrow(
      'invalid ENS gateway signer key',
    )
    await expect(resolve(legacyAddrRequest(name), { gatewaySecret: '0x1234' })).rejects.toThrow(
      'invalid ENS gateway allocation secret',
    )
    const [row] = await db
      .select({ resolutionCounter: ensNames.resolutionCounter })
      .from(ensNames)
      .where(eq(ensNames.id, inserted?.id ?? -1))
    expect(row?.resolutionCounter).toBe(0)
  })
})
