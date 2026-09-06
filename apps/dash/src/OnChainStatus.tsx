/** @jsxImportSource hono/jsx/dom */
import type { GraphAttendance, GraphDelegation, GraphRight } from '@fuda/sdk'
import { short } from '@fuda/ui'
import { useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'
import { graphOnChainStatusIo, loadOnChainStatus } from './on-chain-status.ts'

export type OnChainStatusState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      attendances: Record<string, GraphAttendance[]>
      delegations: GraphDelegation[]
      kind: 'ready'
      rights: GraphRight[]
    }

export interface OnChainStatusProps {
  copy: DashCopy['chain']
  endpoint: string
}

export interface OnChainStatusViewProps {
  copy: DashCopy['chain']
  state: OnChainStatusState
}

const delegationState = (copy: DashCopy['chain'], { active, revokedAt }: GraphDelegation): string => {
  if (revokedAt !== null) {
    return `${copy.revokedAt} ${revokedAt}`
  }
  return active ? copy.active : copy.inactive
}

export const OnChainStatusView = ({ copy, state }: OnChainStatusViewProps): JSX.Element => {
  if (state.kind === 'idle') {
    return <p class="text-sm opacity-70">{copy.idle}</p>
  }
  if (state.kind === 'loading') {
    return (
      <p role="status" aria-live="polite" class="text-sm opacity-70">
        {copy.loading}
      </p>
    )
  }
  if (state.kind === 'error') {
    return (
      <div role="alert" class="alert alert-error">
        {state.message === copy.unconfigured || state.message === copy.errorFallback
          ? state.message
          : `${copy.errorFallback} ${state.message}`}
      </div>
    )
  }
  if (state.rights.length === 0) {
    return (
      <p role="status" aria-live="polite" class="text-sm opacity-70">
        {copy.empty}
      </p>
    )
  }
  return (
    <div class="flex flex-col gap-3">
      <h3 class="font-bold">{copy.statusHeading}</h3>
      {state.rights.map((right): JSX.Element => (
        <article class="rounded-box border-base-300 border p-3" key={right.id}>
          <div class="font-mono text-xs break-all">{right.id}</div>
          <div>{right.revokedAt === null ? copy.active : `${copy.revokedAt} ${right.revokedAt}`}</div>
          <div>{`${copy.holder} ${short(right.holder)}`}</div>
          <div>
            {right.delegation === null
              ? `${copy.unresolvedDelegation} ${right.refUID}`
              : `${copy.delegation} ${right.delegation.id}`}
          </div>
          <ul>
            {(state.attendances[right.id] ?? []).map((attendance): JSX.Element => (
              // Template literal on purpose: hono/jsx/dom cannot render a BigInt child (it
              // is neither string nor number, so buildNode treats it as a vnode and throws).
              <li key={attendance.id}>{`${copy.enteredAt} ${attendance.enteredAt}`}</li>
            ))}
          </ul>
        </article>
      ))}
      <h3 class="font-bold">{copy.delegations}</h3>
      <ul class="flex flex-col gap-2">
        {state.delegations.map((delegation): JSX.Element => (
          <li class="rounded-box border-base-300 border p-2" key={delegation.id}>
            <div>{`${delegationState(copy, delegation)} ${delegation.name}`}</div>
            <div class="font-mono text-xs break-all">{delegation.id}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

const fieldValue = (target: EventTarget | null): string | null =>
  target instanceof HTMLInputElement ? target.value : null

export const OnChainStatus = ({ copy, endpoint }: OnChainStatusProps): JSX.Element => {
  const [holder, setHolder] = useState('')
  const [state, setState] = useState<OnChainStatusState>({ kind: 'idle' })
  const load = async (): Promise<void> => {
    if (state.kind === 'loading') {
      return
    }
    if (endpoint === '') {
      setState({ kind: 'error', message: copy.unconfigured })
      return
    }
    setState({ kind: 'loading' })
    try {
      setState({
        kind: 'ready',
        ...(await loadOnChainStatus(graphOnChainStatusIo, endpoint, holder)),
      })
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : copy.errorFallback })
    }
  }
  return (
    <section class="card bg-base-200 p-4">
      <h2 class="mb-2 text-lg font-bold">{copy.title}</h2>
      <p class="mb-4 text-sm opacity-70">{copy.description}</p>
      <form
        class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          void load()
        }}
      >
        <div class="flex min-w-0 grow flex-col gap-1">
          <label for="chain-holder">{copy.holderLabel}</label>
          <input
            id="chain-holder"
            class="input input-bordered w-full font-mono"
            placeholder={copy.holderPlaceholder}
            value={holder}
            onInput={(event) => {
              const value = fieldValue(event.currentTarget)
              if (value !== null) {
                setHolder(value)
              }
            }}
          />
        </div>
        <button class="btn btn-primary" type="submit" disabled={state.kind === 'loading'}>
          {state.kind === 'loading' ? copy.querying : copy.query}
        </button>
      </form>
      <OnChainStatusView copy={copy} state={state} />
    </section>
  )
}
