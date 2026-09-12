import { FUDA_REGISTRAR_ABI } from '@fuda/ens-contracts'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toHex,
  zeroHash,
} from 'viem'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../src/db/client.ts'
import { ensNames } from '../src/ens/schema.ts'
import type { Bindings } from '../src/env.ts'
import { appWith, fakeChain, testEnv } from './env.ts'
import { CARD_INPUT, operator, postJson, signIn } from './operator.ts'

const REGISTRAR = privateKeyToAccount(`0x${'7c'.repeat(32)}`).address
const VOUCHER_KEY = `0x${'11'.repeat(32)}` as const
const UPSTREAM = 'https://paymaster.invalid/rpc'
const TX_HASH = `0x${'ab'.repeat(32)}` as const
const HANDLE = CARD_INPUT.handle
const IP = '203.0.113.9'

const SMART_WALLET_ABI = parseAbi(['function execute(address dest,uint256 value,bytes func)'])

const configured = (overrides: Partial<Bindings> = {}): Bindings =>
  testEnv({
    ENS_GAS_POLICY_ID: 'policy-1',
    ENS_PARENT_NAME: 'fuda.eth',
    ENS_PAYMASTER_UPSTREAM: UPSTREAM,
    ENS_REGISTRAR_ADDRESS: REGISTRAR,
    ENS_SEPOLIA_RPC_URL: 'https://sepolia.invalid/rpc',
    ENS_VOUCHER_KEY: VOUCHER_KEY,
    ...overrides,
  })

const app = () => appWith({ chain: fakeChain() })

const claimLog = (label: string) => ({
  address: REGISTRAR,
  blockHash: zeroHash,
  blockNumber: '0x1',
  data: encodeAbiParameters(parseAbiParameters('uint64 expiry,uint256 nonce'), [2000n, 0n]),
  logIndex: '0x0',
  removed: false,
  topics: encodeEventTopics({
    abi: FUDA_REGISTRAR_ABI,
    args: { issuer: operator.address, labelHash: keccak256(toHex(label)), tokenId: 1n },
    eventName: 'IssuerClaimed',
  }),
  transactionHash: TX_HASH,
  transactionIndex: '0x0',
})

const receipt = (logs: unknown[], status: '0x0' | '0x1' = '0x1') => ({
  blockHash: zeroHash,
  blockNumber: '0x1',
  contractAddress: null,
  cumulativeGasUsed: '0x1',
  effectiveGasPrice: '0x1',
  from: operator.address,
  gasUsed: '0x1',
  logs,
  logsBloom: `0x${'00'.repeat(256)}`,
  status,
  to: REGISTRAR,
  transactionHash: TX_HASH,
  transactionIndex: '0x0',
  type: '0x2',
})

// One stub for both outbound destinations: the Sepolia RPC the claim routes read
// from, and the vendor the paymaster proxy forwards to.
const rpcAnswer = (result: unknown): Response => Response.json({ id: 1, jsonrpc: '2.0', result })

const stubChain = (
  options: {
    logs?: unknown[]
    receiptStatus?: '0x0' | '0x1'
    upstream?: unknown
    upstreamStatus?: number
  } = {},
) => {
  const calls: { body: { method?: string; params?: unknown[] }; url: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: { body?: string }) => {
      const url = input
      const body = JSON.parse(init?.body ?? '{}') as { method?: string; params?: unknown[] }
      calls.push({ body, url })
      if (url === UPSTREAM) {
        return await Promise.resolve(
          options.upstreamStatus === undefined
            ? rpcAnswer(options.upstream ?? { paymasterAndData: '0xfeed' })
            : Response.json(options.upstream, { status: options.upstreamStatus }),
        )
      }
      if (body.method === 'eth_getTransactionReceipt') {
        return await Promise.resolve(
          rpcAnswer(receipt(options.logs ?? [claimLog(HANDLE)], options.receiptStatus)),
        )
      }
      // Every contract read in these routes returns a single word; the only one
      // is the registrar's per-issuer nonce, which starts at zero.
      return await Promise.resolve(rpcAnswer(`0x${'00'.repeat(32)}`))
    }),
  )
  return calls
}

const withVenue = async (bindings: Bindings) => {
  const created = appWith({ chain: fakeChain() })
  const { token } = await signIn(created, bindings)
  await postJson(created, bindings, '/v1/issuers', CARD_INPUT, token)
  return { app: created, token }
}

const rowFor = async (name: string) =>
  await getDb({ DB: env.DB }).select().from(ensNames).where(eq(ensNames.name, name)).get()

describe('issuer ENS claim', () => {
  beforeEach(async () => {
    await env.DB.exec('DROP TRIGGER IF EXISTS fail_issuer_ens')
    await env.DB.exec('DELETE FROM ens_names')
    await env.DB.exec('DELETE FROM sessions')
    await env.DB.exec('DELETE FROM cards')
    await env.DB.exec('DELETE FROM issuers')
    await env.DB.exec('DELETE FROM rate_limits')
  })

  afterEach(async () => {
    await env.DB.exec('DROP TRIGGER IF EXISTS fail_issuer_ens')
    vi.unstubAllGlobals()
  })

  describe('POST /issuers/me/ens/claim-voucher', () => {
    it('refuses without a session and while ENS is unconfigured', async () => {
      stubChain()
      const bindings = testEnv()
      const anonymous = await postJson(app(), bindings, '/v1/issuers/me/ens/claim-voucher', {})
      const { app: venue, token } = await withVenue(bindings)
      const unconfigured = await postJson(venue, bindings, '/v1/issuers/me/ens/claim-voucher', {}, token)

      expect(anonymous.status).toBe(401)
      expect(unconfigured.status).toBe(503)
    })

    it('answers 404 for an operator with no venue yet', async () => {
      stubChain()
      const bindings = configured()
      const created = app()
      const { token } = await signIn(created, bindings)

      const response = await postJson(created, bindings, '/v1/issuers/me/ens/claim-voucher', {}, token)

      expect(response.status).toBe(404)
    })

    it('signs a voucher for the venue and records the claim as pending', async () => {
      stubChain()
      const bindings = configured()
      const { app: venue, token } = await withVenue(bindings)

      const response = await postJson(venue, bindings, '/v1/issuers/me/ens/claim-voucher', {}, token)
      const body = await response.json<{ name: string; voucher: { label: string; signature: string } }>()

      expect(body.name).toBe(`${HANDLE}.fuda.eth`)
      expect(body.voucher.label).toBe(HANDLE)
      await expect(rowFor(`${HANDLE}.fuda.eth`)).resolves.toMatchObject({ status: 'voucher_issued' })
    })

    it('reports a persistence failure instead of returning an unrecorded voucher', async () => {
      stubChain()
      const bindings = configured()
      const { app: venue, token } = await withVenue(bindings)
      await env.DB.exec(
        "CREATE TRIGGER fail_issuer_ens BEFORE INSERT ON ens_names BEGIN SELECT RAISE(FAIL, 'forced'); END",
      )

      const response = await postJson(venue, bindings, '/v1/issuers/me/ens/claim-voucher', {}, token)

      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toStrictEqual({ error: 'ens_persistence_failed' })
      await expect(rowFor(`${HANDLE}.fuda.eth`)).resolves.toBeUndefined()
    })

    it('refuses a second voucher once the name is claimed', async () => {
      stubChain()
      const bindings = configured()
      const { app: venue, token } = await withVenue(bindings)
      await postJson(venue, bindings, '/v1/issuers/me/ens/claim-voucher', {}, token)
      await postJson(venue, bindings, '/v1/issuers/me/ens/claimed', { txHash: TX_HASH }, token)

      const again = await postJson(venue, bindings, '/v1/issuers/me/ens/claim-voucher', {}, token)

      expect(again.status).toBe(409)
    })
  })

  describe('POST /issuers/me/ens/claimed', () => {
    it('records the claim when the receipt carries the registrar’s own event', async () => {
      stubChain()
      const bindings = configured()
      const { app: venue, token } = await withVenue(bindings)
      await postJson(venue, bindings, '/v1/issuers/me/ens/claim-voucher', {}, token)

      const response = await postJson(
        venue,
        bindings,
        '/v1/issuers/me/ens/claimed',
        { txHash: TX_HASH },
        token,
      )

      expect(response.status).toBe(200)
      await expect(rowFor(`${HANDLE}.fuda.eth`)).resolves.toMatchObject({
        claimTxHash: TX_HASH,
        expiry: 2000,
        status: 'claimed',
      })
    })

    it('reports persistence failure and accepts a retry with the same confirmed hash', async () => {
      stubChain()
      const bindings = configured()
      const { app: venue, token } = await withVenue(bindings)
      await env.DB.exec(
        "CREATE TRIGGER fail_issuer_ens BEFORE INSERT ON ens_names BEGIN SELECT RAISE(FAIL, 'forced'); END",
      )

      const failed = await postJson(venue, bindings, '/v1/issuers/me/ens/claimed', { txHash: TX_HASH }, token)
      expect(failed.status).toBe(503)
      await expect(failed.json()).resolves.toStrictEqual({ error: 'ens_persistence_failed' })
      await expect(rowFor(`${HANDLE}.fuda.eth`)).resolves.toBeUndefined()

      await env.DB.exec('DROP TRIGGER fail_issuer_ens')
      const retried = await postJson(
        venue,
        bindings,
        '/v1/issuers/me/ens/claimed',
        { txHash: TX_HASH },
        token,
      )
      expect(retried.status).toBe(200)
      await expect(rowFor(`${HANDLE}.fuda.eth`)).resolves.toMatchObject({
        claimTxHash: TX_HASH,
        status: 'claimed',
      })
    })

    it('leaves the name pending when the receipt proves another venue’s claim', async () => {
      stubChain({ logs: [claimLog('someone-else')] })
      const bindings = configured()
      const { app: venue, token } = await withVenue(bindings)
      await postJson(venue, bindings, '/v1/issuers/me/ens/claim-voucher', {}, token)

      const response = await postJson(
        venue,
        bindings,
        '/v1/issuers/me/ens/claimed',
        { txHash: TX_HASH },
        token,
      )

      expect(response.status).toBe(409)
      await expect(rowFor(`${HANDLE}.fuda.eth`)).resolves.toMatchObject({ status: 'voucher_issued' })
    })

    it('reports a reverted claim as terminal without recording confirmation', async () => {
      stubChain({ receiptStatus: '0x0' })
      const bindings = configured()
      const { app: venue, token } = await withVenue(bindings)
      await postJson(venue, bindings, '/v1/issuers/me/ens/claim-voucher', {}, token)

      const response = await postJson(
        venue,
        bindings,
        '/v1/issuers/me/ens/claimed',
        { txHash: TX_HASH },
        token,
      )

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toStrictEqual({ error: 'claim_failed' })
      await expect(rowFor(`${HANDLE}.fuda.eth`)).resolves.toMatchObject({ status: 'voucher_issued' })
    })

    it('rejects a malformed transaction hash', async () => {
      stubChain()
      const bindings = configured()
      const { app: venue, token } = await withVenue(bindings)

      const response = await postJson(
        venue,
        bindings,
        '/v1/issuers/me/ens/claimed',
        { txHash: '0x00' },
        token,
      )

      expect(response.status).toBe(400)
    })
  })

  describe('POST /ens/paymaster', () => {
    const sponsoredBody = (target: string) => ({
      id: 1,
      jsonrpc: '2.0',
      method: 'pm_getPaymasterStubData',
      params: [
        {
          callData: encodeFunctionData({
            abi: SMART_WALLET_ABI,
            args: [
              target as Hex,
              0n,
              encodeFunctionData({
                abi: FUDA_REGISTRAR_ABI,
                args: [HANDLE, operator.address, 2000n, 0n, 1500n, '0x1234'],
                functionName: 'claim',
              }),
            ],
            functionName: 'execute',
          }),
        },
        `0x${'5f'.repeat(20)}`,
        '0xaa36a7',
      ] as const,
    })

    const send = async (bindings: Bindings, body: unknown) =>
      await app().request(
        '/v1/ens/paymaster',
        {
          body: JSON.stringify(body),
          headers: { 'CF-Connecting-IP': IP, 'content-type': 'application/json' },
          method: 'POST',
        },
        bindings,
      )

    it('forwards a claim on fuda’s registrar and injects the gas policy', async () => {
      const calls = stubChain()

      const response = await send(configured(), sponsoredBody(REGISTRAR))

      expect(response.status).toBe(200)
      const forwarded = calls.find((call) => call.url === UPSTREAM)
      expect(forwarded?.body.params?.[3]).toStrictEqual({ policyId: 'policy-1' })
    })

    it('forwards the whole user operation, not only the call data it inspected', async () => {
      const calls = stubChain()
      const body = sponsoredBody(REGISTRAR)
      const [operation, ...rest] = body.params
      const fields = {
        callGasLimit: '0x5208',
        initCode: '0x',
        nonce: '0x1',
        sender: `0x${'ab'.repeat(20)}`,
        signature: '0x',
      }

      const response = await send(configured(), { ...body, params: [{ ...operation, ...fields }, ...rest] })

      expect(response.status).toBe(200)
      const forwarded = calls.find((call) => call.url === UPSTREAM)
      expect(forwarded?.body.params?.[0]).toMatchObject(fields)
    })

    it('passes the vendor’s refusal through as 502 (and logs it for `wrangler tail`)', async () => {
      const error = vi.spyOn(console, 'error').mockReturnValue()
      const refusal = { error: { code: -32_602, message: 'Invalid User Operation' }, id: 1, jsonrpc: '2.0' }
      stubChain({ upstream: refusal, upstreamStatus: 400 })

      const response = await send(configured(), sponsoredBody(REGISTRAR))
      error.mockRestore()

      expect(response.status).toBe(502)
      await expect(response.json()).resolves.toStrictEqual(refusal)
    })

    it('passes a JSON-RPC refusal through untouched even when the vendor answers 200', async () => {
      const error = vi.spyOn(console, 'error').mockReturnValue()
      const refusal = {
        error: { code: -32_602, message: 'Unsupported Policy Type: BUNDLER_SPONSORSHIP' },
        id: 1,
        jsonrpc: '2.0',
      }
      stubChain({ upstream: refusal, upstreamStatus: 200 })

      const response = await send(configured(), sponsoredBody(REGISTRAR))
      error.mockRestore()

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toStrictEqual(refusal)
    })

    it('answers a refused call with the JSON-RPC error the wallet expects', async () => {
      const warn = vi.spyOn(console, 'warn').mockReturnValue()
      stubChain()

      const response = await send(configured(), sponsoredBody(`0x${'aa'.repeat(20)}`))
      warn.mockRestore()

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ error: { message: 'call not sponsored' } })
    })

    it('refuses a call to any other contract without contacting the vendor', async () => {
      const calls = stubChain()

      const response = await send(configured(), sponsoredBody(`0x${'aa'.repeat(20)}`))

      expect(response.status).toBe(400)
      expect(calls.some((call) => call.url === UPSTREAM)).toBe(false)
    })

    it('refuses an unsupported method and an unconfigured deployment', async () => {
      stubChain()
      const wrongMethod = await send(configured(), {
        ...sponsoredBody(REGISTRAR),
        method: 'eth_sendTransaction',
      })
      const unconfigured = await send(testEnv(), sponsoredBody(REGISTRAR))

      expect(wrongMethod.status).toBe(400)
      expect(unconfigured.status).toBe(503)
    })
  })
})
