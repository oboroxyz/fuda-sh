import type { Hash, TransactionReceipt } from 'viem'
import { describe, expect, it } from 'vitest'

import { simulateSendAndConfirm } from './transaction.ts'

const hash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hash
const request = { to: 'target', value: 1 }
const result = { address: 'deployed' }
const defer = async () => {
  await Promise.resolve()
}

const receipt = (status: 'success' | 'reverted'): TransactionReceipt => ({
  blockHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  blockNumber: 1n,
  contractAddress: null,
  cumulativeGasUsed: 21_000n,
  effectiveGasPrice: 1n,
  from: '0x1111111111111111111111111111111111111111',
  gasUsed: 21_000n,
  logs: [],
  logsBloom: `0x${'00'.repeat(256)}`,
  status,
  to: '0x2222222222222222222222222222222222222222',
  transactionHash: hash,
  transactionIndex: 0,
  type: 'legacy',
})

describe(simulateSendAndConfirm, () => {
  it('simulates, sends, waits, asserts, and returns the transaction outcome in order', async () => {
    const calls: string[] = []
    const confirmed = receipt('success')

    const outcome = await simulateSendAndConfirm({
      assertReceipt: (actual) => {
        calls.push('assert')
        expect(actual).toBe(confirmed)
      },
      send: async (actualRequest) => {
        await defer()
        calls.push('send')
        expect(actualRequest).toBe(request)
        return hash
      },
      simulate: async () => {
        await defer()
        calls.push('simulate')
        return { request, result }
      },
      wait: async (actualHash) => {
        await defer()
        calls.push('receipt')
        expect(actualHash).toBe(hash)
        return confirmed
      },
    })

    expect(calls).toStrictEqual(['simulate', 'send', 'receipt', 'assert'])
    expect(outcome).toStrictEqual({ hash, receipt: confirmed, result })
  })

  it('does not send when simulation fails', async () => {
    const calls: string[] = []
    const failure = new Error('simulation failed')

    await expect(
      simulateSendAndConfirm({
        assertReceipt: () => {
          calls.push('assert')
        },
        send: async () => {
          await defer()
          calls.push('send')
          return hash
        },
        simulate: async () => {
          await defer()
          calls.push('simulate')
          throw failure
        },
        wait: async () => {
          await defer()
          calls.push('receipt')
          return receipt('success')
        },
      }),
    ).rejects.toBe(failure)

    expect(calls).toStrictEqual(['simulate'])
  })

  it('does not wait for a receipt when sending fails', async () => {
    const calls: string[] = []
    const failure = new Error('send failed')

    await expect(
      simulateSendAndConfirm({
        assertReceipt: () => {
          calls.push('assert')
        },
        send: async () => {
          await defer()
          calls.push('send')
          throw failure
        },
        simulate: async () => {
          await defer()
          calls.push('simulate')
          return { request, result }
        },
        wait: async () => {
          await defer()
          calls.push('receipt')
          return receipt('success')
        },
      }),
    ).rejects.toBe(failure)

    expect(calls).toStrictEqual(['simulate', 'send'])
  })

  it('does not assert a reverted receipt', async () => {
    const calls: string[] = []

    await expect(
      simulateSendAndConfirm({
        assertReceipt: () => {
          calls.push('assert')
        },
        send: async () => {
          await defer()
          calls.push('send')
          return hash
        },
        simulate: async () => {
          await defer()
          calls.push('simulate')
          return { request, result }
        },
        wait: async () => {
          await defer()
          calls.push('receipt')
          return receipt('reverted')
        },
      }),
    ).rejects.toThrow(`transaction reverted: ${hash}`)

    expect(calls).toStrictEqual(['simulate', 'send', 'receipt'])
  })

  it('propagates receipt assertion failures after confirming success', async () => {
    const calls: string[] = []
    const failure = new Error('unexpected outcome')
    const confirmed = receipt('success')

    await expect(
      simulateSendAndConfirm({
        assertReceipt: (actual) => {
          calls.push('assert')
          expect(actual).toBe(confirmed)
          throw failure
        },
        send: async () => {
          await defer()
          calls.push('send')
          return hash
        },
        simulate: async () => {
          await defer()
          calls.push('simulate')
          return { request, result }
        },
        wait: async () => {
          await defer()
          calls.push('receipt')
          return confirmed
        },
      }),
    ).rejects.toBe(failure)

    expect(calls).toStrictEqual(['simulate', 'send', 'receipt', 'assert'])
  })
})
