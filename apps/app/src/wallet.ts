import { asHex, SIGNATURE_RE } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'
import { getAddress, stringToHex } from 'viem'

// The member's Crypto wallet, whichever rail: an EIP-1193 provider.
export interface Eip1193Provider {
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- EIP-1193 is untyped JSON-RPC by contract; every response is parsed into a domain type at the call sites below
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

declare global {
  // An injected wallet writes itself onto the global object; lib.dom does not
  // type it. Declared rather than cast so the read below stays type-safe.
  var ethereum: Eip1193Provider | undefined
}

export const injectedProvider = (): Eip1193Provider | null => globalThis.ethereum ?? null

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

// EIP-191 personal_sign over the UTF-8 challenge string, the message the api
// verifies (§5). Params are [hex-encoded message, address] — the order every
// browser wallet expects.
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
