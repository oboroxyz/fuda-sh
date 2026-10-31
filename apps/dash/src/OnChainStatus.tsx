import type { GraphAttendance, GraphDelegation, GraphRight } from '@fuda/sdk'
import { short } from '@fuda/ui'
import { createSignal, For } from 'solid-js'
import type { JSX } from 'solid-js'

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

// Internal failures retain meaning across locale changes and async completion.
// These private markers are translated only by the view and never shown directly.
const UNCONFIGURED = '\0fuda:chain:unconfigured'
const LOOKUP_FAILED = '\0fuda:chain:lookup-failed'
const EXTERNAL_ERROR = '\0fuda:chain:external:'

const errorMessage = (copy: DashCopy['chain'], message: string): string => {
  if (message.startsWith(EXTERNAL_ERROR)) {
    // Strip exactly our outer prefix; arbitrary external content is never interpreted.
    return `${copy.errorFallback} ${message.slice(EXTERNAL_ERROR.length)}`
  }
  if (message === UNCONFIGURED) {
    return copy.unconfigured
  }
  if (message === LOOKUP_FAILED) {
    return copy.errorFallback
  }
  return `${copy.errorFallback} ${message}`
}

const delegationState = (copy: DashCopy['chain'], { active, revokedAt }: GraphDelegation): string => {
  if (revokedAt !== null) {
    return `${copy.revokedAt} ${revokedAt}`
  }
  return active ? copy.active : copy.inactive
}

const statusView = (copy: DashCopy['chain'], state: OnChainStatusState): JSX.Element => {
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
        {errorMessage(copy, state.message)}
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
      <For each={state.rights}>
        {(right) => (
          <article class="rounded-box border-base-300 border p-3">
            <div class="font-mono text-xs break-all">{right.id}</div>
            <div>{right.revokedAt === null ? copy.active : `${copy.revokedAt} ${right.revokedAt}`}</div>
            <div>{`${copy.holder} ${short(right.holder)}`}</div>
            <div class="dash-chain-reference">
              {right.delegation === null
                ? `${copy.unresolvedDelegation} ${right.refUID}`
                : `${copy.delegation} ${right.delegation.id}`}
            </div>
            <ul>
              <For each={state.attendances[right.id] ?? []}>
                {(attendance) => <li>{`${copy.enteredAt} ${attendance.enteredAt}`}</li>}
              </For>
            </ul>
          </article>
        )}
      </For>
      <h3 class="font-bold">{copy.delegations}</h3>
      <ul class="flex flex-col gap-2">
        <For each={state.delegations}>
          {(delegation) => (
            <li class="rounded-box border-base-300 border p-2">
              <div class="dash-chain-name">{`${delegationState(copy, delegation)} ${delegation.name}`}</div>
              <div class="font-mono text-xs break-all">{delegation.id}</div>
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}

export const OnChainStatusView = (props: OnChainStatusViewProps): JSX.Element => (
  <>{statusView(props.copy, props.state)}</>
)

export const OnChainStatus = (props: OnChainStatusProps): JSX.Element => {
  const [holder, setHolder] = createSignal('')
  const [state, setState] = createSignal<OnChainStatusState>({ kind: 'idle' })
  const load = async (): Promise<void> => {
    if (state().kind === 'loading') {
      return
    }
    const { endpoint } = props
    if (endpoint === '') {
      setState({ kind: 'error', message: UNCONFIGURED })
      return
    }
    setState({ kind: 'loading' })
    try {
      setState({
        kind: 'ready',
        ...(await loadOnChainStatus(graphOnChainStatusIo, endpoint, holder())),
      })
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? `${EXTERNAL_ERROR}${error.message}` : LOOKUP_FAILED,
      })
    }
  }
  return (
    <section class="card bg-base-200 p-4">
      <h2 class="mb-2 text-lg font-bold">{props.copy.title}</h2>
      <p class="mb-4 text-sm opacity-70">{props.copy.description}</p>
      <form
        class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          void load()
        }}
      >
        <div class="flex min-w-0 grow flex-col gap-1">
          <label for="chain-holder">{props.copy.holderLabel}</label>
          <input
            id="chain-holder"
            class="input input-bordered w-full font-mono"
            placeholder={props.copy.holderPlaceholder}
            value={holder()}
            onInput={(event) => {
              setHolder(event.currentTarget.value)
            }}
          />
        </div>
        <button class="btn btn-primary" type="submit" disabled={state().kind === 'loading'}>
          {state().kind === 'loading' ? props.copy.querying : props.copy.query}
        </button>
      </form>
      <OnChainStatusView copy={props.copy} state={state()} />
    </section>
  )
}
