import * as viem from 'viem'
import type { Hex, TransactionReceipt } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { testEnv } from '../../test/env.ts'
import { ChainError, ZERO_ADDRESS, ZERO_UID } from './client.ts'
import { UnknownTransactionOutcomeError } from './unknown-transaction-outcome-error.ts'
import { createViemChain } from './viem-chain.ts'

const rpc = {
  waitForTransactionReceipt: vi.fn<() => Promise<TransactionReceipt>>(),
  writeContract: vi.fn<() => Promise<Hex>>(),
}

const txHash = `0x${'ab'.repeat(32)}` as const
const params = {
  data: '0x',
  expirationTime: 0n,
  recipient: ZERO_ADDRESS,
  refUID: ZERO_UID,
  revocable: true,
  schema: ZERO_UID,
} as const
const chain = () => createViemChain(testEnv({ SIGNER_PRIVATE_KEY: `0x${'11'.repeat(32)}` }))

describe('attest transaction outcome', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetAllMocks()
    vi.spyOn(viem, 'createPublicClient').mockReturnValue({
      ...viem.createPublicClient({
        transport: viem.custom({ request: async () => await Promise.resolve(null) }),
      }),
      waitForTransactionReceipt: rpc.waitForTransactionReceipt,
    })
    vi.spyOn(viem, 'createWalletClient').mockReturnValue({
      ...viem.createWalletClient({
        transport: viem.custom({ request: async () => await Promise.resolve(null) }),
      }),
      writeContract: rpc.writeContract,
    })
    rpc.writeContract.mockResolvedValue(txHash)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves the broadcast hash without leaking the RPC failure', async () => {
    rpc.waitForTransactionReceipt.mockRejectedValue(new Error('https://rpc.test/secret-key'))
    const error: unknown = await chain()
      .attest(params)
      .catch((error_: unknown) => error_)
    expect(error).toBeInstanceOf(ChainError)
    expect(error).toBeInstanceOf(UnknownTransactionOutcomeError)
    expect(error).toMatchObject({ txHash })
    expect(String(error)).not.toContain('secret-key')
  })

  it('reports a confirmed revert as an ordinary chain error', async () => {
    rpc.waitForTransactionReceipt.mockResolvedValue({
      blockHash: ZERO_UID,
      blockNumber: 1n,
      contractAddress: null,
      cumulativeGasUsed: 1n,
      effectiveGasPrice: 1n,
      from: ZERO_ADDRESS,
      gasUsed: 1n,
      logs: [],
      logsBloom: '0x',
      status: 'reverted',
      to: ZERO_ADDRESS,
      transactionHash: txHash,
      transactionIndex: 0,
      type: 'eip1559',
    })
    const error: unknown = await chain()
      .attest(params)
      .catch((error_: unknown) => error_)
    expect(error).toBeInstanceOf(ChainError)
    expect(error).not.toBeInstanceOf(UnknownTransactionOutcomeError)
    expect(error).not.toHaveProperty('txHash')
  })

  it('reports a failure before broadcast as an ordinary chain error', async () => {
    rpc.writeContract.mockRejectedValue(new Error('not sent'))
    const error: unknown = await chain()
      .attest(params)
      .catch((error_: unknown) => error_)
    expect(error).toBeInstanceOf(ChainError)
    expect(error).not.toBeInstanceOf(UnknownTransactionOutcomeError)
    expect(rpc.waitForTransactionReceipt).not.toHaveBeenCalled()
  })
})
