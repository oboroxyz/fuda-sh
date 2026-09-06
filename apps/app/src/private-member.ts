import type { Hex } from '@fuda/sdk'
import { deriveMemberSecret, deriveStealthKeys, matchAnnouncements } from '@fuda/stealth-address'
import type { DiscoveredPass, StealthKeys } from '@fuda/stealth-address'
import { privateKeyToAccount } from 'viem/accounts'

// One passkey + one eval input → one member secret → the same meta-address on
// every device that holds the passkey (docs/specs/pass-types-and-flows.md#u2-privacy-first-issuance).
export const keysFromPrf = (prfOutput: Uint8Array): StealthKeys =>
  deriveStealthKeys(deriveMemberSecret(prfOutput))

// The row shape GET /announcements serves.
export interface AnnouncementDto {
  txHash: Hex
  logIndex: number
  blockNumber: number
  schemeId: number
  stealthAddress: Hex
  caller: Hex
  ephemeralPubKey: Hex
  metadata: Hex
}

// Entirely client-side: the api only served candidates.
export const discover = (keys: StealthKeys, rows: AnnouncementDto[]): DiscoveredPass[] =>
  matchAnnouncements(keys, rows)

// The stealth key is derived, not held by a wallet: it signs the same challenge
// a Signed member's wallet would, so enterSigned needs no second flow.
export const stealthSigner =
  (pass: DiscoveredPass) =>
  async (message: string): Promise<Hex> =>
    await privateKeyToAccount(pass.stealthPrivateKey).signMessage({ message })
