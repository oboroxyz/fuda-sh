import { createPublicClient, custom } from 'viem'
import { describe, expect, it } from 'vitest'

import { observeProbeRpc } from './probe-rpc.ts'

describe('read-only probe RPC evidence', () => {
  it('accepts a completed false validation result', async () => {
    const observed = observeProbeRpc(custom({ request: async () => await Promise.resolve('0x00') }))
    const client = createPublicClient({ transport: observed.transport })

    await expect(client.request({ method: 'eth_call', params: [{ data: '0x' }, 'latest'] })).resolves.toBe(
      '0x00',
    )
    expect(() => {
      observed.assertSucceeded()
    }).not.toThrow()
  })

  it('fails the probe when a caller swallows an RPC error as an invalid signature', async () => {
    const observed = observeProbeRpc(
      custom(
        {
          request: async () => await Promise.reject(new Error('RPC unavailable')),
        },
        { retryCount: 0 },
      ),
    )
    const client = createPublicClient({ transport: observed.transport })

    // The production verifier can fold a transport error into false. The probe
    // must retain failure evidence independently of that caller's result.
    await client.request({ method: 'eth_call', params: [{ data: '0x' }, 'latest'] }).catch(() => false)
    expect(() => {
      observed.assertSucceeded()
    }).toThrow('RPC did not complete')
  })

  it('blocks transaction submission before it reaches the provider', async () => {
    const submitted: string[] = []
    const request = async ({ method }: { method: string }) => {
      submitted.push(method)
      return await Promise.resolve('0x00')
    }
    const observed = observeProbeRpc(custom({ request }))
    const client = createPublicClient({ transport: observed.transport })

    await expect(client.request({ method: 'eth_sendRawTransaction', params: ['0x00'] })).rejects.toThrow(
      'read-only',
    )
    expect(submitted).toStrictEqual([])
    expect(() => {
      observed.assertSucceeded()
    }).toThrow('RPC did not complete')
  })
})
