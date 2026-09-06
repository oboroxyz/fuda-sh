/** @jsxImportSource hono/jsx/dom */
import type { GraphAttendance, GraphDelegation, GraphRight } from '@fuda/sdk'
import { short } from '@fuda/ui'
import { useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { GRAPH_RIGHTS_ENDPOINT } from './config.ts'
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

const delegationState = ({ active, revokedAt }: GraphDelegation): string => {
  if (revokedAt !== null) {
    return `REVOKED at ${revokedAt}`
  }
  return active ? 'ACTIVE' : 'INACTIVE'
}

export const OnChainStatusView = ({ state }: { state: OnChainStatusState }): JSX.Element => {
  if (state.kind === 'idle') {
    return <p class="text-sm opacity-70">Enter a holder to look up its on-chain status.</p>
  }
  if (state.kind === 'loading') {
    return <p class="text-sm opacity-70">Loading on-chain status…</p>
  }
  if (state.kind === 'error') {
    return <div class="alert alert-error">{state.message}</div>
  }
  if (state.rights.length === 0) {
    return <p class="text-sm opacity-70">No on-chain rights found.</p>
  }
  return (
    <div class="flex flex-col gap-3">
      <h3 class="font-bold">On-chain status</h3>
      {state.rights.map((right): JSX.Element => (
        <article class="rounded-box border-base-300 border p-3" key={right.id}>
          <div class="font-mono text-xs break-all">{right.id}</div>
          <div>{right.revokedAt === null ? 'ACTIVE' : `REVOKED at ${right.revokedAt}`}</div>
          <div>holder {short(right.holder)}</div>
          <div>
            {right.delegation === null
              ? `Unresolved delegation ${right.refUID}`
              : `delegation ${right.delegation.id}`}
          </div>
          <ul>
            {(state.attendances[right.id] ?? []).map((attendance): JSX.Element => (
              // Template literal on purpose: hono/jsx/dom cannot render a BigInt child (it
              // is neither string nor number, so buildNode treats it as a vnode and throws).
              <li key={attendance.id}>{`entered at ${attendance.enteredAt}`}</li>
            ))}
          </ul>
        </article>
      ))}
      <h3 class="font-bold">Issuer delegations</h3>
      <ul class="flex flex-col gap-2">
        {state.delegations.map((delegation): JSX.Element => (
          <li class="rounded-box border-base-300 border p-2" key={delegation.id}>
            <div>{`${delegationState(delegation)} ${delegation.name}`}</div>
            <div class="font-mono text-xs break-all">{delegation.id}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

const fieldValue = (target: EventTarget | null): string | null =>
  target instanceof HTMLInputElement ? target.value : null

export const OnChainStatus = (): JSX.Element => {
  const [holder, setHolder] = useState('')
  const [state, setState] = useState<OnChainStatusState>({ kind: 'idle' })
  const load = async (): Promise<void> => {
    if (GRAPH_RIGHTS_ENDPOINT === '') {
      setState({ kind: 'error', message: 'On-chain status is not configured.' })
      return
    }
    setState({ kind: 'loading' })
    try {
      setState({
        kind: 'ready',
        ...(await loadOnChainStatus(graphOnChainStatusIo, GRAPH_RIGHTS_ENDPOINT, holder)),
      })
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Chain lookup failed.' })
    }
  }
  return (
    <section class="card bg-base-200 p-4">
      <h2 class="mb-2 text-lg font-bold">On-chain status</h2>
      <form
        class="mb-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void load()
        }}
      >
        <input
          class="input input-bordered grow font-mono"
          aria-label="Holder address"
          placeholder="0x… holder address"
          value={holder}
          onInput={(event) => {
            const value = fieldValue(event.currentTarget)
            if (value !== null) {
              setHolder(value)
            }
          }}
        />
        <button class="btn btn-primary" type="submit" disabled={state.kind === 'loading'}>
          Query
        </button>
      </form>
      <OnChainStatusView state={state} />
    </section>
  )
}
