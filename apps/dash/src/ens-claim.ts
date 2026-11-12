import type { EnsClaimView, Hex } from '@fuda/sdk'

import type { Result } from './api.ts'
import type { PendingEnsClaim } from './ens-pending.ts'
import type { BundleOutcome } from './wallet.ts'

// Ethereum Sepolia, where ENSv2 lives. Base Sepolia carries the rights; the two
// chains never meet except here (docs/specs/ens-naming.md#deployment-namespace).
export const ENS_CHAIN_ID = 11_155_111

export interface ClaimVoucher {
  deadline: number
  expiry: number
  issuer: Hex
  label: string
  nonce: string
  registrar: Hex
  signature: Hex
}

export interface ClaimVoucherResponse {
  chainId: number
  name: string
  voucher: ClaimVoucher
}

// Why a claim stopped. Each maps to one sentence the operator can act on: only
// `rejected` is their own doing, only `unsponsored` needs fuda to look at the
// paymaster, and `undelegated` means fuda's issuing delegation is not live.
export type ClaimFailure =
  | 'network'
  | 'rejected'
  | 'undelegated'
  | 'unconfigured'
  | 'unsponsored'
  | 'unconfirmed'

const voucherFailures: ReadonlyMap<string, ClaimFailure> = new Map([
  ['ens_not_configured', 'unconfigured'],
  ['not_delegated', 'undelegated'],
])

export type ClaimState =
  | { kind: 'unclaimed' }
  | { kind: 'signing' }
  | { kind: 'submitting'; name: string }
  | { kind: 'confirming'; name: string }
  | { kind: 'pending'; pending: PendingEnsClaim }
  | { kind: 'claimed'; name: string; claimTxHash: Hex | null }
  | { kind: 'failed'; failure: ClaimFailure }

export interface ClaimIo {
  // Asks the api to sign the authorization the registrar checks.
  requestVoucher: () => Promise<Result<ClaimVoucherResponse>>
  // Puts the operator's wallet on Ethereum Sepolia and submits the claim there,
  // sponsored. Resolves with the accepted bundle ID before polling.
  submitClaim: (voucher: ClaimVoucher) => Promise<string>
  resolveBundle: (id: string) => Promise<BundleOutcome>
  // Hands the hash back to the api, which records the claim only if the chain
  // agrees the registrar emitted it for this venue.
  confirmClaim: (txHash: Hex) => Promise<Result<EnsClaimView>>
}

// The state the dashboard starts in, from what /issuers/me already said.
export const initialClaimState = (ens: EnsClaimView | null): ClaimState =>
  ens !== null && ens.status === 'claimed'
    ? { claimTxHash: ens.claimTxHash, kind: 'claimed', name: ens.name }
    : { kind: 'unclaimed' }

export const reconcileClaimState = (
  current: ClaimState,
  ens: EnsClaimView | null,
  pending: PendingEnsClaim | null,
  previousEnsName?: string,
): ClaimState => {
  if (ens === null || ens.status === 'claimed') {
    return initialClaimState(ens)
  }
  if (previousEnsName !== undefined && ens.name !== previousEnsName) {
    return initialClaimState(ens)
  }
  if (current.kind === 'signing') {
    return current
  }
  if ((current.kind === 'submitting' || current.kind === 'confirming') && current.name === ens.name) {
    return current
  }
  if (current.kind === 'pending' && current.pending.name === ens.name) {
    return current
  }
  return pending?.name === ens.name ? { kind: 'pending', pending } : initialClaimState(ens)
}

// The wallet reports a refusal and a declined sponsorship as ordinary errors, so
// the message is the only thing that separates "the operator said no" from
// "fuda would not pay" — and telling them apart is what makes the failure line
// actionable.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a thrown value has no contract; this is where one is given
const failureOf = (error: unknown): ClaimFailure => {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('reject') || message.includes('denied') || message.includes('cancel')) {
    return 'rejected'
  }
  return message.includes('paymaster') || message.includes('sponsor') ? 'unsponsored' : 'network'
}

export const runClaim = async (
  io: ClaimIo,
  emit: (state: ClaimState) => void,
  retained?: PendingEnsClaim,
  onPending?: (pending: PendingEnsClaim | null) => void,
): Promise<ClaimState> => {
  let pending = retained
  const finish = (state: ClaimState): ClaimState => {
    emit(state)
    return state
  }
  const failed = (): ClaimState => {
    onPending?.(null)
    return finish({ failure: 'unconfirmed', kind: 'failed' })
  }
  try {
    if (pending === undefined) {
      emit({ kind: 'signing' })
      const voucher = await io.requestVoucher()
      if (!voucher.ok) {
        return finish({ failure: voucherFailures.get(voucher.error) ?? 'network', kind: 'failed' })
      }
      emit({ kind: 'submitting', name: voucher.body.name })
      const bundleId = await io.submitClaim(voucher.body.voucher)
      pending = { bundleId, name: voucher.body.name }
      onPending?.(pending)
    }
    emit({ kind: 'confirming', name: pending.name })
    if ('bundleId' in pending) {
      const outcome = await io.resolveBundle(pending.bundleId)
      if (outcome.kind === 'reverted') {
        return failed()
      }
      if (outcome.kind === 'pending') {
        return finish({ kind: 'pending', pending })
      }
      pending = { name: pending.name, txHash: outcome.txHash }
      onPending?.(pending)
    }
    const confirmed = await io.confirmClaim(pending.txHash)
    if (!confirmed.ok) {
      return confirmed.error === 'claim_failed' ? failed() : finish({ kind: 'pending', pending })
    }
    onPending?.(null)
    return finish({ claimTxHash: confirmed.body.claimTxHash, kind: 'claimed', name: confirmed.body.name })
  } catch (error) {
    return finish(
      pending === undefined ? { failure: failureOf(error), kind: 'failed' } : { kind: 'pending', pending },
    )
  }
}

export const claimIsBusy = (state: ClaimState): boolean =>
  state.kind === 'signing' || state.kind === 'submitting' || state.kind === 'confirming'
