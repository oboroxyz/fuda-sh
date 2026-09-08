import type { EnsClaimView, Hex } from '@fuda/sdk'

import type { Result } from './api.ts'

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
// `rejected` is their own doing, and only `unsponsored` needs fuda to look at
// the paymaster.
export type ClaimFailure = 'network' | 'rejected' | 'unconfigured' | 'unsponsored' | 'unconfirmed'

export type ClaimState =
  | { kind: 'unclaimed' }
  | { kind: 'signing' }
  | { kind: 'submitting'; name: string }
  | { kind: 'confirming'; name: string }
  | { kind: 'claimed'; name: string; claimTxHash: Hex | null }
  | { kind: 'failed'; failure: ClaimFailure; name?: string; txHash?: Hex }

export interface ClaimIo {
  // Asks the api to sign the authorization the registrar checks.
  requestVoucher: () => Promise<Result<ClaimVoucherResponse>>
  // Puts the operator's wallet on Ethereum Sepolia and submits the claim there,
  // sponsored. Resolves with the transaction hash the wallet settled on.
  submitClaim: (voucher: ClaimVoucher) => Promise<Hex>
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
  pending: { name: string; txHash: Hex } | null,
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
  if (current.kind === 'failed' && current.name === ens.name && current.txHash !== undefined) {
    return current
  }
  return pending?.name === ens.name
    ? { failure: 'unconfirmed', kind: 'failed', ...pending }
    : initialClaimState(ens)
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

// One press, three legs: sign, submit, confirm. Each leg reports before the next
// begins, because the middle one waits on a person and a chain and the operator
// should be able to see which of the three they are waiting for.
//
// An abandoned wallet prompt leaves nothing behind — the voucher goes unused and
// the next press signs a fresh one at the same nonce — so failure always returns
// to a state the operator can retry from.
export const runClaim = async (
  io: ClaimIo,
  emit: (state: ClaimState) => void,
  pending?: { name: string; txHash: Hex },
  onPending?: (pending: { name: string; txHash: Hex } | null) => void,
): Promise<ClaimState> => {
  if (pending !== undefined) {
    emit({ kind: 'confirming', name: pending.name })
    const confirmed = await io.confirmClaim(pending.txHash)
    if (!confirmed.ok) {
      if (confirmed.error === 'claim_failed') {
        onPending?.(null)
        const state: ClaimState = { failure: 'unconfirmed', kind: 'failed' }
        emit(state)
        return state
      }
      const state: ClaimState = { failure: 'unconfirmed', kind: 'failed', ...pending }
      emit(state)
      return state
    }
    onPending?.(null)
    const state: ClaimState = {
      claimTxHash: confirmed.body.claimTxHash,
      kind: 'claimed',
      name: confirmed.body.name,
    }
    emit(state)
    return state
  }
  emit({ kind: 'signing' })
  const voucher = await io.requestVoucher()
  if (!voucher.ok) {
    const failure: ClaimFailure = voucher.error === 'ens_not_configured' ? 'unconfigured' : 'network'
    const state: ClaimState = { failure, kind: 'failed' }
    emit(state)
    return state
  }

  emit({ kind: 'submitting', name: voucher.body.name })
  let txHash: Hex
  try {
    txHash = await io.submitClaim(voucher.body.voucher)
  } catch (error) {
    const state: ClaimState = { failure: failureOf(error), kind: 'failed' }
    emit(state)
    return state
  }
  onPending?.({ name: voucher.body.name, txHash })

  emit({ kind: 'confirming', name: voucher.body.name })
  const confirmed = await io.confirmClaim(txHash)
  if (!confirmed.ok) {
    if (confirmed.error === 'claim_failed') {
      onPending?.(null)
      const state: ClaimState = { failure: 'unconfirmed', kind: 'failed' }
      emit(state)
      return state
    }
    // The transaction may still be in flight; the api refuses to record a claim
    // it cannot see. Retrying is safe and is the whole remedy.
    const state: ClaimState = { failure: 'unconfirmed', kind: 'failed', name: voucher.body.name, txHash }
    emit(state)
    return state
  }
  const state: ClaimState = {
    claimTxHash: confirmed.body.claimTxHash,
    kind: 'claimed',
    name: confirmed.body.name,
  }
  onPending?.(null)
  emit(state)
  return state
}

export const claimIsBusy = (state: ClaimState): boolean =>
  state.kind === 'signing' || state.kind === 'submitting' || state.kind === 'confirming'
