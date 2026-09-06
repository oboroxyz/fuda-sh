/** @jsxImportSource hono/jsx/dom */
import { fetchRightsByHolder } from '@fuda/sdk'
import type { GraphRight } from '@fuda/sdk'
import { short } from '@fuda/ui'
import { useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { GRAPH_RIGHTS_ENDPOINT } from './config.ts'

export type RightsListState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rights: GraphRight[] }

const SAFE_META_PROTOCOLS = new Set(['http:', 'https:', 'ipfs:'])

const safeMetaHref = (value: string): string | null => {
  if (!URL.canParse(value)) {
    return null
  }
  return SAFE_META_PROTOCOLS.has(new URL(value).protocol) ? value : null
}

const metaUri = (value: string): JSX.Element | null => {
  if (value === '') {
    return null
  }
  const href = safeMetaHref(value)
  return href === null ? <span>{value}</span> : <a href={href}>{value}</a>
}

export const RightsListView = ({ state }: { state: RightsListState }): JSX.Element => {
  if (state.kind === 'idle') {
    return <p class="text-sm opacity-70">Enter a holder address to read its on-chain rights.</p>
  }
  if (state.kind === 'loading') {
    return <p class="text-sm opacity-70">Loading rights…</p>
  }
  if (state.kind === 'error') {
    return <div class="alert alert-error">{state.message}</div>
  }
  if (state.rights.length === 0) {
    return <p class="text-sm opacity-70">No rights found for this holder.</p>
  }
  return (
    <ul class="grid gap-3 md:grid-cols-2">
      {state.rights.map((right): JSX.Element => (
        <li class="card bg-base-200" key={right.id}>
          <div class="card-body gap-2">
            <div class={right.revokedAt === null ? 'badge badge-success' : 'badge badge-error'}>
              {right.revokedAt === null ? 'ACTIVE' : 'REVOKED'}
            </div>
            <div class="font-mono text-xs break-all">{right.id}</div>
            <div class="text-sm">issuer {short(right.issuer)}</div>
            <div class="text-sm">tier {right.tier}</div>
            <div class="text-sm">usage model {right.usageModel}</div>
            {metaUri(right.metaURI)}
          </div>
        </li>
      ))}
    </ul>
  )
}

const fieldValue = (target: EventTarget | null): string | null =>
  target instanceof HTMLInputElement ? target.value : null

export const RightsList = (): JSX.Element => {
  const [holder, setHolder] = useState('')
  const [state, setState] = useState<RightsListState>({ kind: 'idle' })

  const load = async (): Promise<void> => {
    if (GRAPH_RIGHTS_ENDPOINT === '') {
      setState({ kind: 'error', message: 'Rights lookup is not configured.' })
      return
    }
    setState({ kind: 'loading' })
    try {
      setState({ kind: 'ready', rights: await fetchRightsByHolder(GRAPH_RIGHTS_ENDPOINT, holder) })
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Rights lookup failed.' })
    }
  }

  return (
    <main class="flex min-h-screen flex-col gap-4 p-6">
      <h1 class="text-xl font-bold">My rights</h1>
      <form
        class="flex max-w-xl gap-2"
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
          Look up
        </button>
      </form>
      <RightsListView state={state} />
    </main>
  )
}
