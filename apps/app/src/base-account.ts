import { createBaseAccountSDK } from '@base-org/account'

import type { Eip1193Provider } from './wallet.ts'

// The passkey smart-wallet rail (spec §10.1, §16.4): the SDK runs the passkey
// ceremony and exposes an EIP-1193 provider, so the gate flow is unchanged.
export const baseAccountProvider = (): Eip1193Provider =>
  createBaseAccountSDK({ appChainIds: [84_532], appName: 'fuda' }).getProvider()
