/* oxlint-disable max-classes-per-file -- ChainError and NoSignerError are the two failure modes of this one port; splitting them would separate an error from its interface */
import type { Hex } from 'viem'

export interface RawAttestation {
  uid: Hex
  schema: Hex
  time: bigint
  expirationTime: bigint
  revocationTime: bigint
  refUID: Hex
  recipient: Hex
  attester: Hex
  revocable: boolean
  data: Hex
}

export interface AttestParams {
  schema: Hex
  recipient: Hex
  refUID: Hex
  data: Hex
  revocable: boolean
  expirationTime: bigint
}

export interface VerifyMessageParams {
  address: Hex
  message: string
  signature: Hex
}

export class ChainError extends Error {
  override readonly name = 'ChainError'
}

export class NoSignerError extends Error {
  override readonly name = 'NoSignerError'
}

export interface ChainClient {
  /** Signer address, or null when SIGNER_PRIVATE_KEY is unset (write calls then throw NoSignerError). */
  signerAddress: () => Hex | null
  /** EAS.getAttestation via eth_call. A missing uid returns a struct with uid = 0x00…00. Throws ChainError on RPC failure. */
  readAttestation: (uid: Hex) => Promise<RawAttestation>
  /** Coinbase Smart Wallet factory getAddress(owners, nonce) — pure CREATE2 computation, nothing deployed. */
  getAddressFromFactory: (owners: Hex[], nonce: bigint) => Promise<Hex>
  /** Submit an attestation and wait for the receipt; returns the new uid. Throws NoSignerError / ChainError. */
  attest: (p: AttestParams) => Promise<{ uid: Hex; txHash: Hex }>
  /** Revoke; waits for the receipt. Throws ChainError when the tx reverts (unknown or already-revoked uid). */
  revoke: (schema: Hex, uid: Hex) => Promise<{ txHash: Hex }>
  /** EIP-191 personal-sign check for the challenge (§3 step 3): EOA via ecrecover, deployed smart accounts via ERC-1271, undeployed via ERC-6492. false for any invalid or malformed signature; ChainError only when the chain could not be consulted. */
  verifyMessage: (p: VerifyMessageParams) => Promise<boolean>
  // Plan 4 extends this with announce() and getAnnouncementLogs().
}

export const ZERO_UID: Hex = `0x${'00'.repeat(32)}`
export const ZERO_ADDRESS: Hex = `0x${'00'.repeat(20)}`
