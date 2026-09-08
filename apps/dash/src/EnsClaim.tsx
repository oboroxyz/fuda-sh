/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'
import { claimIsBusy } from './ens-claim.ts'
import type { ClaimState } from './ens-claim.ts'

export interface EnsClaimProps {
  copy: DashCopy['ens']
  // The name the venue would claim, from its handle. Shown before the claim so
  // the operator sees what they are getting.
  name: string
  onClaim: () => void
  state: ClaimState
}

const EXPLORER = 'https://sepolia.etherscan.io/tx/'

const progressLine = (copy: DashCopy['ens'], state: ClaimState): string | null => {
  if (state.kind === 'signing') {
    return copy.signing
  }
  if (state.kind === 'submitting') {
    return copy.submitting
  }
  return state.kind === 'confirming' ? copy.confirming : null
}

const claimedBlock = (copy: DashCopy['ens'], state: ClaimState): JSX.Element | null => {
  if (state.kind !== 'claimed') {
    return null
  }
  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <span class="badge badge-success badge-sm">{copy.claimedLabel}</span>
        <code class="font-mono text-sm">{state.name}</code>
      </div>
      {state.claimTxHash === null ? null : (
        <a
          class="link text-xs opacity-70"
          href={`${EXPLORER}${state.claimTxHash}`}
          rel="noreferrer"
          target="_blank"
        >
          {copy.explorer}
        </a>
      )}
    </div>
  )
}

export const EnsClaim = ({ copy, name, onClaim, state }: EnsClaimProps): JSX.Element => {
  const busy = claimIsBusy(state)
  const progress = progressLine(copy, state)
  const claimed = state.kind === 'claimed'
  return (
    <section aria-label={copy.title} class="rounded-box border-base-300 flex flex-col gap-3 border p-4">
      <header class="flex flex-col gap-1">
        <h2 class="font-bold">{copy.title}</h2>
        {claimed ? null : <p class="text-sm opacity-70">{copy.description.replace('{name}', name)}</p>}
      </header>

      {claimedBlock(copy, state)}

      {state.kind === 'failed' ? (
        <p class="text-error text-sm" role="alert">
          {copy.failures[state.failure]}
        </p>
      ) : null}

      {progress === null ? null : <p class="text-sm opacity-70">{progress}</p>}

      {claimed ? null : (
        <button class="btn btn-primary self-start" disabled={busy} onClick={onClaim} type="button">
          {state.kind === 'failed' ? copy.retry : copy.claim}
        </button>
      )}
    </section>
  )
}
