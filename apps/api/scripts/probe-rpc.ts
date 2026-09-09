import assert from 'node:assert/strict'

import type { Transport } from 'viem'

const READ_METHODS = new Set(['eth_chainId', 'eth_call', 'eth_getCode'])

interface ProbeRpc {
  transport: Transport
  assertSucceeded: () => void
}

// Verification libraries can fold RPC exceptions into a false signature verdict.
// Preserve independent evidence that every probe request completed. A revert is
// also inconclusive here: these negative fixtures must return an actual result.
export const observeProbeRpc = (underlying: Transport): ProbeRpc => {
  let failed = false
  const transport: Transport = (options) => {
    const rpc = underlying(options)
    return {
      ...rpc,
      request: async (args, requestOptions) => {
        try {
          assert.ok(READ_METHODS.has(args.method), 'The wallet probe allows read-only RPC methods only.')
          return await rpc.request(args, requestOptions)
        } catch (error) {
          failed = true
          throw error
        }
      },
    }
  }
  return {
    assertSucceeded: () => {
      assert.equal(failed, false, 'RPC did not complete; wallet probe results are inconclusive.')
    },
    transport,
  }
}
