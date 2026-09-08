import { asHex, SIGNATURE_RE } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'
import * as v from 'valibot'
import { getAddress, stringToHex } from 'viem'

// The operator's passkey wallet, whichever rail: an EIP-1193 provider.
export interface Eip1193Provider {
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- EIP-1193 is untyped JSON-RPC by contract; every response is parsed into a domain type below
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

// A provider's responses are untyped by the EIP-1193 contract, so every value
// coming back is re-validated here before it is handed on as Hex.
export const requestAccount = async (p: Eip1193Provider): Promise<Hex> => {
  const accounts = await p.request({ method: 'eth_requestAccounts' })
  const first = Array.isArray(accounts) ? String(accounts[0]) : ''
  const hex = asHex(first, 20)
  if (hex === null) {
    throw new Error('wallet returned no account')
  }
  return getAddress(hex)
}

// EIP-191 personal_sign over the UTF-8 sign-in message the api verifies
// (docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route).
// Params are [hex-encoded message, address] — the order every browser wallet expects.
export const personalSign = async (p: Eip1193Provider, address: Hex, message: string): Promise<Hex> => {
  const sig = String(await p.request({ method: 'personal_sign', params: [stringToHex(message), address] }))
  if (!SIGNATURE_RE.test(sig)) {
    throw new Error('wallet returned no signature')
  }
  // Annotated (not cast): SIGNATURE_RE guarantees the 0x prefix, so the template
  // literal narrows to Hex. Case is preserved — a signature is opaque bytes.
  const signature: Hex = `0x${sig.slice(2)}`
  return signature
}

// Base Sepolia carries the rights; Ethereum Sepolia carries the ENS names, and a
// venue owner holds no gas on either. Declaring both chains lets the same wallet
// sign an ENS claim, and `paymasterUrls` is what makes fuda pay for it: the SDK
// injects the ERC-7677 `paymasterService` capability for that chain on its own.
const toChainIdHex = (chainId: number): string => `0x${chainId.toString(16)}`

const ENS_CHAIN_ID = 11_155_111
const BASE_SEPOLIA_CHAIN_ID = 84_532

// The passkey smart-wallet rail. Imported dynamically by the caller so the
// SDK stays out of the sign-in screen's first paint.
export const baseAccountProvider = async (paymasterUrl = ''): Promise<Eip1193Provider> => {
  const { createBaseAccountSDK } = await import('@base-org/account')
  const chains = { appChainIds: [BASE_SEPOLIA_CHAIN_ID, ENS_CHAIN_ID], appName: 'fuda' }
  // Without a paymaster the wallet asks the operator for gas it does not have,
  // so an unconfigured deployment is better off never offering the claim at all.
  if (paymasterUrl === '') {
    return createBaseAccountSDK(chains).getProvider()
  }
  return createBaseAccountSDK({
    ...chains,
    paymasterUrls: { [ENS_CHAIN_ID]: paymasterUrl },
  }).getProvider()
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

// Polls until the bundle settles. A wallet that never settles is a failure the
// operator can retry, not a spinner that runs forever.
const waitForCall = async (p: Eip1193Provider, id: string): Promise<Hex> => {
  for (const _attempt of Array.from({ length: POLL_LIMIT })) {
    // oxlint-disable-next-line no-await-in-loop -- polling is sequential by nature; each read decides whether to poll again
    const status = await p.request({ method: 'wallet_getCallsStatus', params: [id] })
    const hash = settledHash(status)
    if (hash !== null) {
      return hash
    }
    // oxlint-disable-next-line no-await-in-loop -- the wait between polls is the point
    await pause(POLL_MS)
  }
  throw new Error('the wallet did not settle the claim')
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
): Promise<Hex> => {
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
  return await waitForCall(p, callBundleId(id))
}
