import type { Eip1193Provider } from '@fuda/libs/wallet'
import type { Hex } from '@fuda/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { sendSponsoredCall, waitForCall } from './wallet.ts'

const TX: Hex = `0x${'ab'.repeat(32)}`
const ADDRESS: Hex = `0x${'11'.repeat(20)}`

describe('ENS wallet bundles', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the accepted bundle ID without waiting for settlement', async () => {
    const request = vi.fn<Eip1193Provider['request']>(
      async ({ method }: { method: string }) =>
        await Promise.resolve(method === 'wallet_sendCalls' ? { id: 'bundle-1' } : null),
    )
    await expect(
      sendSponsoredCall(
        { request },
        {
          chainId: 11_155_111,
          data: '0x',
          from: ADDRESS,
          paymasterUrl: '',
          to: ADDRESS,
        },
      ),
    ).resolves.toBe('bundle-1')
    expect(request.mock.calls.map(([call]) => call.method)).toStrictEqual([
      'wallet_switchEthereumChain',
      'wallet_sendCalls',
    ])
  })

  it('returns pending after the polling budget and can settle on the next check', async () => {
    vi.useFakeTimers()
    let settled = false
    const request = vi.fn<Eip1193Provider['request']>(
      async () =>
        await Promise.resolve(
          settled ? { receipts: [{ transactionHash: TX }], status: 200 } : { status: 100 },
        ),
    )
    const first = waitForCall({ request }, 'bundle-1')
    await vi.advanceTimersByTimeAsync(90_000)
    await expect(first).resolves.toStrictEqual({ kind: 'pending' })
    settled = true
    await expect(waitForCall({ request }, 'bundle-1')).resolves.toStrictEqual({ kind: 'settled', txHash: TX })
    expect(request).toHaveBeenCalledTimes(61)
  })

  it.each([400, 500])('recognizes definitive wallet failure %s', async (status) => {
    const request = async () => await Promise.resolve({ receipts: [{ transactionHash: TX }], status })
    await expect(waitForCall({ request }, 'bundle-1')).resolves.toStrictEqual({ kind: 'reverted' })
  })
})
