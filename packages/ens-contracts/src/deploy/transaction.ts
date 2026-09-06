import type { Hash, TransactionReceipt } from 'viem'

export interface ConfirmedWriteInput<Result, Request> {
  assertReceipt: (receipt: TransactionReceipt) => Promise<void> | void
  send: (simulatedRequest: Request) => Promise<Hash>
  simulate: () => Promise<{ request: Request; result: Result }>
  wait: (hash: Hash) => Promise<TransactionReceipt>
}

export const simulateSendAndConfirm = async <Result, Request>(
  input: ConfirmedWriteInput<Result, Request>,
) => {
  const { request, result } = await input.simulate()
  const hash = await input.send(request)
  const receipt = await input.wait(hash)
  if (receipt.status !== 'success') {
    throw new Error(`transaction reverted: ${hash}`)
  }
  await input.assertReceipt(receipt)
  return { hash, receipt, result }
}
