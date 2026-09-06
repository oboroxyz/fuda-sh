import type { GraphAnnouncement, Hex } from '@fuda/sdk'
import { deriveMemberSecret, deriveStealthKeys, matchAnnouncements } from '@fuda/stealth-address'
import type { DiscoveredPass, StealthKeys } from '@fuda/stealth-address'
import { privateKeyToAccount } from 'viem/accounts'

// One passkey + one eval input → one member secret → the same meta-address on
// every device that holds the passkey (docs/specs/pass-types-and-flows.md#u2-privacy-first-issuance).
export const keysFromPrf = (prfOutput: Uint8Array): StealthKeys =>
  deriveStealthKeys(deriveMemberSecret(prfOutput))

// Entirely client-side: Graph serves only raw public candidates.
export const discover = (keys: StealthKeys, rows: GraphAnnouncement[]): DiscoveredPass[] =>
  matchAnnouncements(keys, rows)

// The stealth key is derived, not held by a wallet: it signs the same challenge
// a Signed member's wallet would, so enterSigned needs no second flow.
export const stealthSigner =
  (pass: DiscoveredPass) =>
  async (message: string): Promise<Hex> =>
    await privateKeyToAccount(pass.stealthPrivateKey).signMessage({ message })
