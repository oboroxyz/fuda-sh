import { keccak256, pad, toBytes } from 'viem'
import type { Hex } from 'viem'

import type { ChainClient } from './client.ts'

// The Bearer holder is a Claimable smart account (Coinbase Smart Wallet) at a
// counterfactual address: sole owner = the fuda signer, nonce = keccak(memberId).
// Nothing is deployed; the member takes control later via Activation (B1).
export const bearerHolder = async (
  chain: ChainClient,
  issuerAddress: Hex,
  memberId: string,
): Promise<Hex> => {
  const nonce = BigInt(keccak256(toBytes(memberId)))
  const owners = [pad(issuerAddress, { size: 32 })]
  return await chain.getAddressFromFactory(owners, nonce)
}
