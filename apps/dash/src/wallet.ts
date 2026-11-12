import { baseAccountProvider as createProvider } from '@fuda/libs/wallet'
import type { Eip1193Provider } from '@fuda/libs/wallet'
import { asHex } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'
import * as v from 'valibot'

import { CHAIN } from './config.ts'
import { ENS_CHAIN_ID } from './ens-claim.ts'

export { personalSign, requestAccount } from '@fuda/libs/wallet'
export type { Eip1193Provider } from '@fuda/libs/wallet'

const toChainIdHex = (chainId: number): string => `0x${chainId.toString(16)}`
export const baseAccountProvider = async (paymasterUrl = ''): Promise<Eip1193Provider> => {
  const options = { appChainIds: [CHAIN.id, ENS_CHAIN_ID] }
  if (paymasterUrl === '') {
    return await createProvider(options)
  }
  return await createProvider({ ...options, paymasterUrls: { [ENS_CHAIN_ID]: paymasterUrl } })
}

// EIP-5792 leaves both of these loose: an id may be a bare string or an object
// carrying one, and a status may or may not have settled yet. Parsed here, at
// the wallet boundary, rather than inspected at the call site.
const BundleId = v.union([
  v.pipe(v.string(), v.minLength(1)),
  v.pipe(
    v.object({ id: v.pipe(v.string(), v.minLength(1)) }),
    v.transform((value) => value.id),
  ),
])

const CallsStatus = v.object({
  receipts: v.optional(v.array(v.object({ transactionHash: v.string() }))),
  status: v.optional(v.number()),
})

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- EIP-1193 answers are untyped by contract; the schema above is that parse
const callBundleId = (value: unknown): string => {
  const parsed = v.safeParse(BundleId, value)
  if (!parsed.success) {
    throw new Error('wallet returned no call bundle')
  }
  return parsed.output
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- as above: this is the boundary where a wallet's answer becomes a domain value
const settledHash = (status: unknown): Hex | null => {
  const parsed = v.safeParse(CallsStatus, status)
  const hash = parsed.success ? parsed.output.receipts?.[0]?.transactionHash : undefined
  return hash === undefined ? null : asHex(hash, 32)
}

const POLL_MS = 1500
const POLL_LIMIT = 60

const pause = async (ms: number): Promise<void> => {
  // oxlint-disable-next-line promise/avoid-new -- setTimeout has no promise form in the browser
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export type BundleOutcome = { kind: 'settled'; txHash: Hex } | { kind: 'pending' } | { kind: 'reverted' }

export const waitForCall = async (p: Eip1193Provider, id: string): Promise<BundleOutcome> => {
  for (const _attempt of Array.from({ length: POLL_LIMIT })) {
    // oxlint-disable-next-line no-await-in-loop -- polling is sequential by nature; each read decides whether to poll again
    const status = await p.request({ method: 'wallet_getCallsStatus', params: [id] })
    const parsed = v.safeParse(CallsStatus, status)
    if (
      parsed.success &&
      parsed.output.status !== undefined &&
      parsed.output.status >= 400 &&
      parsed.output.status < 600
    ) {
      return { kind: 'reverted' }
    }
    const hash = settledHash(status)
    if (hash !== null) {
      return { kind: 'settled', txHash: hash }
    }
    // oxlint-disable-next-line no-await-in-loop -- the wait between polls is the point
    await pause(POLL_MS)
  }
  return { kind: 'pending' }
}

// EIP-5792. The wallet bundles the call, the paymaster pays for it, and the
// receipt comes back through `wallet_getCallsStatus`; `eth_sendTransaction`
// would work too but would not wait for the bundle to settle.
//
// The capability is attached here rather than left to `paymasterUrls`: the SDK
// injects it on the path it builds itself, and this request goes to the
// provider directly. Sending it twice is harmless; not sending it at all means
// the wallet asks a venue owner for gas they do not have. The envelope matches
// the SDK's own shape (`version: '1.0'`, `atomicRequired`) rather than guessing
// what the popup accepts.
export const sendSponsoredCall = async (
  p: Eip1193Provider,
  input: { chainId: number; data: Hex; from: Hex; paymasterUrl: string; to: Hex },
): Promise<string> => {
  await p.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: toChainIdHex(input.chainId) }],
  })
  const call = {
    atomicRequired: true,
    calls: [{ data: input.data, to: input.to, value: '0x0' }],
    chainId: toChainIdHex(input.chainId),
    from: input.from,
    version: '1.0',
  }
  const params =
    input.paymasterUrl === ''
      ? [call]
      : [{ ...call, capabilities: { paymasterService: { url: input.paymasterUrl } } }]
  const id = await p.request({ method: 'wallet_sendCalls', params })
  return callBundleId(id)
}
