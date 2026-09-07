import { FUDA_REGISTRAR_ABI } from '@fuda/ens-contracts'
import { encodeFunctionData } from 'viem'
import type { Hex } from 'viem'

import { ENS_PAYMASTER_URL } from './config.ts'
import { ENS_CHAIN_ID } from './ens-claim.ts'
import type { ClaimVoucher } from './ens-claim.ts'
import { baseAccountProvider, requestAccount, sendSponsoredCall } from './wallet.ts'

// The claim as the registrar takes it. The voucher's own fields go on the wire
// unchanged: the signature covers every one of them, so re-deriving any here
// would only invent a way to disagree with what fuda signed.
export const claimCallData = (voucher: ClaimVoucher): Hex =>
  encodeFunctionData({
    abi: FUDA_REGISTRAR_ABI,
    args: [
      voucher.label,
      voucher.issuer,
      BigInt(voucher.expiry),
      BigInt(voucher.nonce),
      BigInt(voucher.deadline),
      voucher.signature,
    ],
    functionName: 'claim',
  })

// Puts the operator's wallet on Ethereum Sepolia and sends the claim there,
// sponsored through fuda's paymaster proxy. The operator signs; fuda pays.
export const submitClaim = async (voucher: ClaimVoucher): Promise<Hex> => {
  const provider = await baseAccountProvider(ENS_PAYMASTER_URL)
  const from = await requestAccount(provider)
  return await sendSponsoredCall(provider, {
    chainId: ENS_CHAIN_ID,
    data: claimCallData(voucher),
    from,
    paymasterUrl: ENS_PAYMASTER_URL,
    to: voucher.registrar,
  })
}
