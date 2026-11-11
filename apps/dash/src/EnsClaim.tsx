import type { JSX } from 'preact'

import type { DashCopy } from './copy.ts'
import { claimIsBusy } from './ens-claim.ts'
import type { ClaimState } from './ens-claim.ts'
import { VenueLinkIcon } from './VenueLinkIcon.tsx'

export interface EnsClaimProps {
  copy: DashCopy['ens']
  // The name the venue would claim, from its handle. Shown before the claim so
  // the operator sees what they are getting.
  name: string
  // The wallet that would hold the name; null on a venue an account owns.
  ownerAddress: string | null
  onClaim: () => void
  state: ClaimState
}

const EXPLORER = 'https://sepolia.etherscan.io/address/'

const progressLine = (copy: DashCopy['ens'], state: ClaimState): string | null => {
  if (state.kind === 'signing') {
    return copy.signing
  }
  if (state.kind === 'submitting') {
    return copy.submitting
  }
  if (state.kind === 'pending') {
    return copy.pending
  }
  return state.kind === 'confirming' ? copy.confirming : null
}

const claimLabel = (copy: DashCopy['ens'], state: ClaimState): string => {
  if (state.kind === 'pending') {
    return copy.recheck
  }
  return state.kind === 'failed' ? copy.retry : copy.claim
}

export const EnsClaim = (props: EnsClaimProps): JSX.Element => {
  const progress: string | null = progressLine(props.copy, props.state)
  const claimed: boolean = props.state.kind === 'claimed'
  const claimedName: string | undefined = props.state.kind === 'claimed' ? props.state.name : undefined
  const failure: string | null =
    props.state.kind === 'failed' ? props.copy.failures[props.state.failure] : null
  return (
    <section aria-label={props.copy.title} class="flex flex-col gap-2 pt-2">
      <div class="flex flex-wrap items-center gap-2">
        <VenueLinkIcon kind="link" />
        {claimed ? (
          <a
            class="link link-hover text-sm wrap-anywhere"
            href={`${EXPLORER}${props.ownerAddress ?? ''}`}
            rel="noopener noreferrer"
            target="_blank"
            title={props.copy.explorer}
          >
            {claimedName}
          </a>
        ) : (
          <span class="text-sm wrap-anywhere">{props.name}</span>
        )}
        {claimed ? (
          <svg
            aria-label={props.copy.claimedLabel}
            class="text-primary size-4 shrink-0"
            fill="currentColor"
            role="img"
            viewBox="0 0 24 24"
          >
            <title>{props.copy.claimedLabel}</title>
            <path d="m12 2 2.6 1.8 3.2.2 1.2 3 2.5 2-.7 3.1.7 3.1-2.5 2-1.2 3-3.2.2L12 22l-2.6-1.8-3.2-.2-1.2-3-2.5-2 .7-3.1L2.5 8.8l2.5-2 1.2-3 3.2-.2L12 2Z" />
            <path
              d="m8 12 2.5 2.5L16 9"
              fill="none"
              stroke="white"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        ) : null}
        {!claimed && props.ownerAddress !== null ? (
          <button
            class="btn btn-primary btn-xs"
            disabled={claimIsBusy(props.state)}
            onClick={() => {
              props.onClaim()
            }}
            type="button"
          >
            {claimLabel(props.copy, props.state)}
          </button>
        ) : null}
      </div>
      {props.ownerAddress === null && !claimed ? (
        <p class="text-sm opacity-70" role="status">
          {props.copy.walletRequired}
        </p>
      ) : null}
      {failure === null ? null : (
        <p class="text-error text-sm" role="alert">
          {failure}
        </p>
      )}

      {progress === null ? null : (
        <p class="text-sm opacity-70" role="status">
          {progress}
        </p>
      )}
    </section>
  )
}
