/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'
import { claimIsBusy } from './ens-claim.ts'
import type { ClaimState } from './ens-claim.ts'
import { VenueLinkIcon } from './VenueLinkIcon.tsx'

export interface EnsClaimProps {
  copy: DashCopy['ens']
  // The name the venue would claim, from its handle. Shown before the claim so
  // the operator sees what they are getting.
  name: string
  ownerAddress: string
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
  return state.kind === 'confirming' ? copy.confirming : null
}

export const EnsClaim = ({ copy, name, onClaim, ownerAddress, state }: EnsClaimProps): JSX.Element => {
  const busy = claimIsBusy(state)
  const progress = progressLine(copy, state)
  const claimed = state.kind === 'claimed'
  return (
    <section aria-label={copy.title} class="flex flex-col gap-2 pt-2">
      <div class="flex flex-wrap items-center gap-2">
        <VenueLinkIcon kind="link" />
        {claimed ? (
          <a
            class="link link-hover text-sm wrap-anywhere"
            href={`${EXPLORER}${ownerAddress}`}
            rel="noopener noreferrer"
            target="_blank"
            title={copy.explorer}
          >
            {state.name}
          </a>
        ) : (
          <span class="text-sm wrap-anywhere">{name}</span>
        )}
        {claimed ? (
          <svg
            aria-label={copy.claimedLabel}
            class="text-primary size-4 shrink-0"
            fill="currentColor"
            role="img"
            viewBox="0 0 24 24"
          >
            <title>{copy.claimedLabel}</title>
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
        ) : (
          <button class="btn btn-primary btn-xs" disabled={busy} onClick={onClaim} type="button">
            {state.kind === 'failed' ? copy.retry : copy.claim}
          </button>
        )}
      </div>
      {state.kind === 'failed' ? (
        <p class="text-error text-sm" role="alert">
          {copy.failures[state.failure]}
        </p>
      ) : null}

      {progress === null ? null : <p class="text-sm opacity-70">{progress}</p>}
    </section>
  )
}
