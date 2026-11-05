import type { Hex } from 'viem'

// Who an operator session acts as: an account, identified by its passkeys, or the
// wallet that signed in. Issuers and connected apps belong to one or the other, and a
// wallet session never reaches an account's issuers or the reverse.
export type OperatorPrincipal = { accountId: string; kind: 'account' } | { address: Hex; kind: 'wallet' }

// The owner column of the tables a principal owns rows in. An address stays as it is,
// and the prefix keeps an account id from ever reading as one.
export const ACCOUNT_KEY_PREFIX = 'account:'

export const principalKey = (principal: OperatorPrincipal): string =>
  principal.kind === 'account' ? `${ACCOUNT_KEY_PREFIX}${principal.accountId}` : principal.address
