import { env } from 'cloudflare:test'
import * as v from 'valibot'
import { encodeFunctionData, namehash, parseAbi, toHex } from 'viem'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { packetToBytes } from 'viem/ens'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { rateLimits } from '../src/db/schema.ts'
import { ensNames } from '../src/ens/schema.ts'
import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain, testEnv } from './env.ts'

const RESOLVER_SERVICE_ABI = parseAbi([
  'function resolve(bytes name, bytes data) view returns (bytes result, uint64 expires, bytes signature)',
])
const ADDR_ABI = parseAbi(['function addr(bytes32 node) view returns (address)'])
const OWNER = `0x${'11'.repeat(20)}` as const
const TARGET = `0x${'22'.repeat(20)}` as const
const SIGNER_KEY = `0x${'33'.repeat(32)}` as const
const GATEWAY_SECRET = `0x${'44'.repeat(32)}` as const
const RESOLVER = privateKeyToAccount(`0x${'55'.repeat(32)}`).address
const OTHER_RESOLVER = privateKeyToAccount(`0x${'66'.repeat(32)}`).address
const IP = '203.0.113.42'

const requestData = (name: string): Hex =>
  encodeFunctionData({
    abi: RESOLVER_SERVICE_ABI,
    args: [
      toHex(packetToBytes(name)),
      encodeFunctionData({ abi: ADDR_ABI, args: [namehash(name)], functionName: 'addr' }),
    ],
    functionName: 'resolve',
  })

const configured = (): Bindings => ({
  ...testEnv({ ADMIN_TOKEN: 'admin-token' }),
  ENS_GATEWAY_SECRET: GATEWAY_SECRET,
  ENS_GATEWAY_SIGNER_KEY: SIGNER_KEY,
  ENS_PARENT_NAME: 'fuda.eth',
  ENS_RESOLVER_ADDRESSES: `${OTHER_RESOLVER}, ${RESOLVER}`,
})

const post = async (body: string, bindings = configured(), ip = IP): Promise<Response> =>
  await appWith({ chain: fakeChain(), now: () => 100 }).request(
    '/ens/gateway',
    {
      body,
      headers: { 'CF-Connecting-IP': ip, 'content-type': 'application/json' },
      method: 'POST',
    },
    bindings,
  )

const insertName = async (name: string): Promise<void> => {
  await getDb({ DB: env.DB })
    .insert(ensNames)
    .values({
      createdAt: 1,
      issuerHandle: name.split('.')[0] ?? '',
      kind: 'issuer',
      name,
      ownerAddress: OWNER,
      status: 'offchain',
      targetAddress: TARGET,
      updatedAt: 1,
    })
}

describe('POST /ens/gateway', () => {
  beforeEach(async () => {
    await getDb({ DB: env.DB }).delete(rateLimits)
  })

  it('returns the standard signed data body for an allowlisted resolver without admin auth', async () => {
    const name = 'coffee.fuda.eth'
    await insertName(name)

    const res = await post(JSON.stringify({ data: requestData(name), sender: RESOLVER.toLowerCase() }))

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-auth-mode')).toBeNull()
    const body = v.parse(v.object({ data: v.string() }), await res.json())
    expect(body.data).toMatch(/^0x[0-9a-f]+$/u)
  })

  it('404s a valid but unconfigured resolver sender', async () => {
    const res = await post(JSON.stringify({ data: requestData('coffee.fuda.eth'), sender: OWNER }))

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toStrictEqual({ message: 'Gateway address not supported.' })
  })

  it.each([
    ['malformed JSON', '{', 'Invalid gateway request.'],
    ['invalid sender', JSON.stringify({ data: '0x1234', sender: 'nope' }), 'Invalid gateway request.'],
    ['malformed calldata', JSON.stringify({ data: '0x1234', sender: RESOLVER }), 'malformed gateway request'],
  ])('400s %s with a standard error body', async (_case, body, message) => {
    const res = await post(body)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toStrictEqual({ message })
  })

  it('404s when the canonical name has no active record', async () => {
    const res = await post(JSON.stringify({ data: requestData('unknown.fuda.eth'), sender: RESOLVER }))

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toStrictEqual({ message: 'ENS name or record not found.' })
  })

  it('503s before resolution when required gateway configuration is absent', async () => {
    const bindings = { ...configured(), ENS_PARENT_NAME: undefined }
    const res = await post(
      JSON.stringify({ data: requestData('coffee.fuda.eth'), sender: RESOLVER }),
      bindings,
    )

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toStrictEqual({ message: 'Gateway is not configured.' })
  })

  it('returns an EIP-3668 error body when the hourly IP budget is exhausted', async () => {
    await getDb({ DB: env.DB }).insert(rateLimits).values({ count: 120, ip: IP, windowStart: 0 })

    const res = await post(JSON.stringify({ data: requestData('coffee.fuda.eth'), sender: RESOLVER }))

    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toStrictEqual({ message: 'Rate limit exceeded.' })
  })
})
