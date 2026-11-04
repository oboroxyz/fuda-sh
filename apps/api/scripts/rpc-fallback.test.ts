import { once } from 'node:events'
import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'

import { parseChainConfig } from '@fuda/chains'
import * as v from 'valibot'
import { isHex, keccak256, parseTransaction } from 'viem'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { ChainError, ZERO_ADDRESS, ZERO_UID } from '../src/chain/client.ts'
import { createChainTransport, createViemChain } from '../src/chain/viem-chain.ts'

const rpcRequest = v.object({
  id: v.number(),
  method: v.string(),
  params: v.optional(v.array(v.unknown())),
})
type RpcRequest = v.InferOutput<typeof rpcRequest>
type Respond = (request: RpcRequest, response: ServerResponse) => void

const result = (request: RpcRequest, response: ServerResponse, value: unknown) => {
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({ id: request.id, jsonrpc: '2.0', result: value }))
}

const rpcServer = async (respond: Respond) => {
  const requests: RpcRequest[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf-8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      const parsed = v.parse(rpcRequest, JSON.parse(body))
      requests.push(parsed)
      respond(parsed, response)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  onTestFinished(async () => {
    server.closeAllConnections()
    await server[Symbol.asyncDispose]()
  })
  const address = v.parse(v.object({ port: v.number() }), server.address())
  return { requests, url: `http://127.0.0.1:${address.port}/provider-secret` }
}

const unavailable: Respond = (_request, response) => {
  response.writeHead(503)
  response.end('unavailable')
}

const chainAt = (primary: string, secondary: string, signer?: `0x${string}`, chainId?: string) =>
  createViemChain(
    {
      ANNOUNCER_ADDRESS: ZERO_ADDRESS,
      BASE_RPC_URL: primary,
      CHAIN_ID: chainId,
      EAS_ADDRESS: ZERO_ADDRESS,
      FACTORY_ADDRESS: ZERO_ADDRESS,
      SIGNER_PRIVATE_KEY: signer,
    },
    createChainTransport(primary, secondary),
  )

const callOne: Respond = (request, response) => {
  result(request, response, `0x${'0'.repeat(63)}1`)
}

const DEFAULT_RPC = parseChainConfig().publicRpc

const signature: Hex = `0x${'11'.repeat(65)}`

// Node listeners exercise viem's actual fetch, timeout, JSON-RPC errors and signing.
describe('Base Sepolia RPC fallback', () => {
  it.each([undefined, DEFAULT_RPC])('uses one HTTP transport for %s', (primary) => {
    const transport = createChainTransport(primary)({})
    expect(transport.config.type).toBe('http')
    expect(transport.config.retryCount).toBe(0)
    expect(transport.config.timeout).toBe(1000)
  })

  it('reads through the second server after an HTTP outage', async () => {
    const primary = await rpcServer(unavailable)
    const secondary = await rpcServer(callOne)
    const chain = chainAt(primary.url, secondary.url)

    await expect(chain.offchainRevokedAt(ZERO_ADDRESS, ZERO_UID)).resolves.toBe(1n)
    expect(primary.requests.map((request) => request.method)).toStrictEqual(['eth_call'])
    expect(secondary.requests.map((request) => request.method)).toStrictEqual(['eth_call'])
  })

  it.each([false, true])(
    'times out a stalled primary with headers %s and keeps it first on the next read',
    async (headersSent) => {
      const primary = await rpcServer((_request, response) => {
        if (headersSent) {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.flushHeaders()
          response.write('{')
        }
      })
      const secondary = await rpcServer(callOne)
      const chain = chainAt(primary.url, secondary.url)

      await expect(chain.rootTimestamp(ZERO_UID)).resolves.toBe(1n)
      await expect(chain.rootTimestamp(ZERO_UID)).resolves.toBe(1n)
      expect(primary.requests).toHaveLength(2)
      expect(secondary.requests).toHaveLength(2)
    },
  )

  it('does not contact the second server when the primary answers', async () => {
    const primary = await rpcServer(callOne)
    const secondary = await rpcServer(unavailable)

    await expect(chainAt(primary.url, secondary.url).rootTimestamp(ZERO_UID)).resolves.toBe(1n)
    expect(secondary.requests).toHaveLength(0)
  })

  it.each([
    { code: 3, message: 'reverted' },
    { code: -32_000, message: 'execution reverted: denied' },
  ])('does not fail over a contract revert $code', async (rpcError) => {
    const primary = await rpcServer((request, response) => {
      response.end(JSON.stringify({ error: rpcError, id: request.id, jsonrpc: '2.0' }))
    })
    const secondary = await rpcServer(callOne)

    await expect(chainAt(primary.url, secondary.url).rootTimestamp(ZERO_UID)).rejects.toBeInstanceOf(
      ChainError,
    )
    expect(primary.requests).toHaveLength(1)
    expect(secondary.requests).toHaveLength(0)
  })

  it('verifies a smart-account signature through the second endpoint', async () => {
    const primary = await rpcServer(unavailable)
    const secondary = await rpcServer((request, response) => {
      result(request, response, '0x01')
    })

    await expect(
      chainAt(primary.url, secondary.url).verifyMessage({
        address: ZERO_ADDRESS,
        message: 'gate challenge',
        signature,
      }),
    ).resolves.toBe(true)
    expect(secondary.requests.map((request) => request.method)).toStrictEqual(['eth_call'])
  })

  it('retains a false signature verdict when both endpoints are unavailable', async () => {
    const primary = await rpcServer(unavailable)
    const secondary = await rpcServer(unavailable)

    await expect(
      chainAt(primary.url, secondary.url).verifyMessage({
        address: ZERO_ADDRESS,
        message: 'gate challenge',
        signature,
      }),
    ).resolves.toBe(false)
    expect(primary.requests).toHaveLength(1)
    expect(secondary.requests).toHaveLength(1)
  })

  it('still recovers a valid EOA signature when both endpoints are unavailable', async () => {
    const primary = await rpcServer(unavailable)
    const secondary = await rpcServer(unavailable)
    const account = privateKeyToAccount(`0x${'33'.repeat(32)}`)
    const message = 'gate challenge'
    const signed = await account.signMessage({ message })

    await expect(
      chainAt(primary.url, secondary.url).verifyMessage({
        address: account.address,
        message,
        signature: signed,
      }),
    ).resolves.toBe(true)
    expect(primary.requests).toHaveLength(1)
    expect(secondary.requests).toHaveLength(1)
  })

  it('keeps provider URLs and causes out of errors that callers log', async () => {
    const primary = await rpcServer(unavailable)
    const chain = chainAt(primary.url, primary.url)
    const failure = await chain.rootTimestamp(ZERO_UID).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ChainError)
    expect(String(failure)).not.toContain('provider-secret')
    expect(String(failure)).not.toContain(primary.url)
    expect(failure).not.toHaveProperty('cause')
    expect(primary.requests).toHaveLength(1)
  })

  it.each([undefined, '8453'])(
    'rebroadcasts the same locally signed transaction on configured chain %s after the primary accepts but stays silent',
    async (chainId) => {
      const accepted: string[] = []
      const serveWallet: Respond = (request, response) => {
        switch (request.method) {
          case 'eth_fillTransaction': {
            response.end(
              JSON.stringify({
                error: { code: -32_601, message: 'Method not found' },
                id: request.id,
                jsonrpc: '2.0',
              }),
            )
            break
          }
          case 'eth_getTransactionCount': {
            result(request, response, '0x0')
            break
          }
          case 'eth_getBlockByNumber': {
            result(request, response, {
              baseFeePerGas: '0x1',
              gasLimit: '0x1c9c380',
              number: '0x1',
              timestamp: '0x1',
              transactions: [],
            })
            break
          }
          case 'eth_maxPriorityFeePerGas': {
            result(request, response, '0x1')
            break
          }
          case 'eth_estimateGas': {
            result(request, response, '0x100000')
            break
          }
          case 'eth_sendRawTransaction': {
            const serialized = v.parse(v.string(), request.params?.[0])
            if (!isHex(serialized)) {
              throw new Error('Expected a signed transaction')
            }
            accepted.push(serialized)
            if (accepted.length > 1) {
              result(request, response, keccak256(serialized))
            }
            break
          }
          case 'eth_getTransactionReceipt': {
            result(request, response, {
              blockHash: ZERO_UID,
              blockNumber: '0x1',
              cumulativeGasUsed: '0x1',
              effectiveGasPrice: '0x1',
              from: ZERO_ADDRESS,
              gasUsed: '0x1',
              logs: [],
              logsBloom: `0x${'00'.repeat(256)}`,
              status: '0x1',
              to: ZERO_ADDRESS,
              transactionHash: ZERO_UID,
              transactionIndex: '0x0',
              type: '0x2',
            })
            break
          }
          default: {
            throw new Error(`Unexpected RPC method ${request.method}`)
          }
        }
      }
      const primary = await rpcServer(serveWallet)
      const secondary = await rpcServer(serveWallet)
      const chain = chainAt(primary.url, secondary.url, `0x${'22'.repeat(32)}`, chainId)

      await expect(chain.revoke(ZERO_UID, ZERO_UID)).resolves.toHaveProperty('txHash')
      expect(accepted).toHaveLength(2)
      expect(accepted[0]).toBe(accepted[1])
      const [serialized] = accepted
      if (serialized === undefined || !isHex(serialized)) {
        throw new Error('Expected a signed transaction')
      }
      expect(parseTransaction(serialized).nonce).toBe(0)
      expect(parseTransaction(serialized).chainId).toBe(chainId === undefined ? 84_532 : 8453)
      for (const endpoint of [primary, secondary]) {
        expect(endpoint.requests.filter((request) => request.method.startsWith('eth_send'))).toHaveLength(1)
        expect(endpoint.requests.some((request) => request.method === 'eth_sendTransaction')).toBe(false)
      }
    },
  )
})

describe('RPC URLs from chain configuration', () => {
  it.each([
    { chainId: undefined, rpc: 'https://sepolia.base.org' },
    { chainId: '8453', rpc: 'https://mainnet.base.org' },
  ])('uses $rpc for CHAIN_ID=$chainId with and without a preferred RPC', async ({ chainId, rpc }) => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = input instanceof Request ? input.url : String(input)
        urls.push(url)
        return await Promise.resolve(
          url === 'https://preferred.test/'
            ? new Response('', { status: 503 })
            : Response.json({ id: 1, jsonrpc: '2.0', result: '0x2a' }),
        )
      }),
    )
    onTestFinished(() => {
      vi.unstubAllGlobals()
    })
    const bindings = {
      ANNOUNCER_ADDRESS: ZERO_ADDRESS,
      CHAIN_ID: chainId,
      EAS_ADDRESS: ZERO_ADDRESS,
      FACTORY_ADDRESS: ZERO_ADDRESS,
    }
    await expect(createViemChain(bindings).blockNumber()).resolves.toBe(42)
    await expect(
      createViemChain({ ...bindings, BASE_RPC_URL: 'https://preferred.test/' }).blockNumber(),
    ).resolves.toBe(42)
    expect(urls).toStrictEqual([`${rpc}/`, 'https://preferred.test/', `${rpc}/`])
  })
})
