import type { Hex } from 'viem'

import { ChainError } from './client.ts'

export class UnknownTransactionOutcomeError extends ChainError {
  override readonly name = 'UnknownTransactionOutcomeError'

  readonly txHash: Hex

  constructor(txHash: Hex) {
    super('Transaction broadcast but its outcome is unknown')
    this.txHash = txHash
  }
}
