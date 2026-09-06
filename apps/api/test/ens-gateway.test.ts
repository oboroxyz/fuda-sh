import { env } from 'cloudflare:test'
import * as v from 'valibot'
import { encodeFunctionData, namehash, parseAbi, toHex } from 'viem'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { packetToBytes } from 'viem/ens'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const configured = (overrides: Partial<Bindings> = {}): Bindings =>
  testEnv({
    ADMIN_TOKEN: 'admin-token',
    ENS_GATEWAY_SECRET: GATEWAY_SECRET,
    ENS_GATEWAY_SIGNER_KEY: SIGNER_KEY,
    ENS_PARENT_NAME: 'fuda.eth',
    ENS_RESOLVER_ADDRESSES: `${OTHER_RESOLVER}, ${RESOLVER}`,
    ...overrides,
  })

const failQueriesContaining = (needle: string): D1Database => ({
  batch: async <T = unknown>(statements: D1PreparedStatement[]) => await env.DB.batch<T>(statements),
  dump: async () => await env.DB.dump(),
  exec: async (query: string) => await env.DB.exec(query),
  prepare: (query: string) => {
    if (query.includes(needle)) {
      throw new Error(`injected D1 failure for ${needle}`)
    }
    return env.DB.prepare(query)
  },
  withSession: (constraint) => env.DB.withSession(constraint),
})

const expectMessageResponse = async (res: Response, message: string): Promise<void> => {
  expect(res.headers.get('cache-control')).toBe('no-store')
  await expect(res.json()).resolves.toStrictEqual({ message })
}

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
    await expectMessageResponse(res, 'Gateway address not supported.')
  })

  it.each([
    ['malformed JSON', '{', 'Invalid gateway request.'],
    ['invalid sender', JSON.stringify({ data: '0x1234', sender: 'nope' }), 'Invalid gateway request.'],
    ['malformed calldata', JSON.stringify({ data: '0x1234', sender: RESOLVER }), 'malformed gateway request'],
  ])('400s %s with a standard error body', async (_case, body, message) => {
    const res = await post(body)

    expect(res.status).toBe(400)
    await expectMessageResponse(res, message)
  })

  it('404s when the canonical name has no active record', async () => {
    const res = await post(JSON.stringify({ data: requestData('unknown.fuda.eth'), sender: RESOLVER }))

    expect(res.status).toBe(404)
    await expectMessageResponse(res, 'ENS name or record not found.')
  })

  it.each([
    ['allocation secret', { ENS_GATEWAY_SECRET: undefined }],
    ['signer key', { ENS_GATEWAY_SIGNER_KEY: undefined }],
    ['parent name', { ENS_PARENT_NAME: undefined }],
    ['resolver allowlist', { ENS_RESOLVER_ADDRESSES: undefined }],
    ['malformed parent', { ENS_PARENT_NAME: 'not..eth' }],
    ['malformed resolver allowlist', { ENS_RESOLVER_ADDRESSES: 'not-an-address' }],
    ['invalid allocation secret', { ENS_GATEWAY_SECRET: '0x1234' }],
    ['invalid signer key', { ENS_GATEWAY_SIGNER_KEY: '0x1234' }],
  ])('503s before resolution when %s is not configured', async (_case, overrides) => {
    const res = await post(
      JSON.stringify({ data: requestData('coffee.fuda.eth'), sender: RESOLVER }),
      configured(overrides),
    )

    expect(res.status).toBe(503)
    await expectMessageResponse(res, 'Gateway is not configured.')
  })

  it('returns an EIP-3668 error body when the hourly IP budget is exhausted', async () => {
    await getDb({ DB: env.DB }).insert(rateLimits).values({ count: 120, ip: IP, windowStart: 0 })

    const res = await post(JSON.stringify({ data: requestData('coffee.fuda.eth'), sender: RESOLVER }))

    expect(res.status).toBe(429)
    await expectMessageResponse(res, 'Rate limit exceeded.')
  })

  it('400s without a client IP using the gateway error envelope', async () => {
    const res = await post(
      JSON.stringify({ data: requestData('coffee.fuda.eth'), sender: RESOLVER }),
      configured(),
      '',
    )

    expect(res.status).toBe(400)
    await expectMessageResponse(res, 'Client IP required.')
  })

  it.each([
    ['rate limit persistence', 'rate_limits'],
    ['ENS lookup', 'ens_names'],
  ])('wraps unexpected %s failures in the gateway error envelope', async (_case, table) => {
    const logged = vi.spyOn(console, 'error').mockReturnValue()
    const res = await post(
      JSON.stringify({ data: requestData('coffee.fuda.eth'), sender: RESOLVER }),
      configured({ DB: failQueriesContaining(table) }),
    )
    logged.mockRestore()

    expect(res.status).toBe(500)
    await expectMessageResponse(res, 'Internal gateway error.')
  })
})
