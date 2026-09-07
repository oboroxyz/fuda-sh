import { FUDA_REGISTRAR_ABI } from '@fuda/ens-contracts'
import { decodeFunctionData, isAddress, isAddressEqual, isHex, parseAbi, toFunctionSelector } from 'viem'
import type { Address, Hex } from 'viem'

// What a Coinbase Smart Wallet puts in a user operation's `callData`: one call,
// or a batch of them. The wallet is the sender, so this is the only layer that
// names the contract the operation actually touches.
const SMART_WALLET_ABI = parseAbi([
  'function execute(address dest,uint256 value,bytes func)',
  'function executeBatch((address target,uint256 value,bytes data)[] calls)',
])

// The only two things fuda pays for. Neither vendor can express "sponsor calls to
// this contract and no other" — Alchemy's allowlist is by sender, and our senders
// are venue accounts that do not exist until they claim — so the restriction
// lives here (docs/specs/ens-naming.md#issuer-claim-and-renewal).
const SPONSORED_SELECTORS = new Set<string>([
  toFunctionSelector('claim(string,address,uint64,uint256,uint64,bytes)'),
  toFunctionSelector('renew(string,address,uint64,uint256,uint64,bytes)'),
])

const innerCalls = (callData: Hex): readonly { data: Hex; target: Address }[] | null => {
  try {
    const decoded = decodeFunctionData({ abi: SMART_WALLET_ABI, data: callData })
    if (decoded.functionName === 'execute') {
      const [target, , data] = decoded.args
      return [{ data, target }]
    }
    return decoded.args[0].map((call) => ({ data: call.data, target: call.target }))
  } catch {
    return null
  }
}

const allowed = (call: { data: Hex; target: Address }, registrar: Address): boolean =>
  isAddressEqual(call.target, registrar) && SPONSORED_SELECTORS.has(call.data.slice(0, 10))

// A sponsored transaction spends fuda's money, and the paymaster endpoint is
// public by construction — its URL ships in the dashboard bundle. A user
// operation is paid for only when every call it makes is a claim or a renewal on
// fuda's own registrar. An operation that reverts still costs the sponsor, so
// this refuses before the vendor is contacted rather than after.
export const sponsorable = (callData: string, registrar: string): boolean => {
  if (!isHex(callData) || !isAddress(registrar)) {
    return false
  }
  const calls = innerCalls(callData)
  if (calls === null || calls.length === 0) {
    return false
  }
  return calls.every((call) => allowed(call, registrar))
}

// Kept beside the selector set so a change to the registrar ABI that renames a
// sponsored function fails here rather than silently widening what fuda pays for.
export const SPONSORED_FUNCTIONS = FUDA_REGISTRAR_ABI.filter(
  (item) => item.type === 'function' && (item.name === 'claim' || item.name === 'renew'),
)
