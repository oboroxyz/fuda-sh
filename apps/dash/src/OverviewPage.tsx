/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'
import { apiConnectionStatus, countMembers, graphIsConfigured, memberSnapshot } from './members-state.ts'
import type { MembersState } from './members-state.ts'

export interface OverviewPageProps {
  apiBaseUrl: string
  copy: DashCopy['overview']
  graphEndpoint: string
  state: MembersState
}

const apiStatusCopy = (copy: DashCopy['overview'], state: MembersState): string => {
  const status = apiConnectionStatus(state)
  if (status === 'connected') {
    return copy.connected
  }
  if (status === 'unavailable') {
    return copy.unavailable
  }
  return copy.checking
}

export const OverviewPage = ({ apiBaseUrl, copy, graphEndpoint, state }: OverviewPageProps): JSX.Element => {
  const snapshot = memberSnapshot(state)
  const initialLoading = state.kind === 'loading' && snapshot === null
  const counts = snapshot === null ? null : countMembers(snapshot.rows)
  let stateMessage: string | null = null
  if (snapshot !== null) {
    if (snapshot.refreshing) {
      stateMessage = copy.refreshing
    } else if (snapshot.stale) {
      stateMessage = copy.stale
    }
  }

  const countValue = (value: number | null): JSX.Element | string => {
    if (value !== null) {
      return String(value)
    }
    if (initialLoading) {
      return (
        <span aria-hidden="true" class="loading loading-dots loading-sm">
          …
        </span>
      )
    }
    return '—'
  }

  return (
    <section class="flex flex-col gap-6">
      <header>
        <h1 class="text-2xl font-bold">{copy.title}</h1>
        <p class="opacity-70">{copy.description}</p>
      </header>

      <section class="card bg-base-200 p-4" aria-label={copy.title}>
        {stateMessage === null ? null : <p class="text-sm opacity-70">{stateMessage}</p>}
        <div class="stats stats-vertical sm:stats-horizontal shadow">
          <div class="stat">
            <div class="stat-title">{copy.total}</div>
            <div class="stat-value">{countValue(counts?.total ?? null)}</div>
          </div>
          <div class="stat">
            <div class="stat-title">{copy.active}</div>
            <div class="stat-value">{countValue(counts?.active ?? null)}</div>
          </div>
          <div class="stat">
            <div class="stat-title">{copy.revoked}</div>
            <div class="stat-value">{countValue(counts?.revoked ?? null)}</div>
          </div>
        </div>
        {initialLoading ? (
          <p aria-live="polite" class="sr-only">
            {copy.checking}
          </p>
        ) : null}
      </section>

      <section class="card bg-base-200 p-4">
        <dl class="grid gap-4 sm:grid-cols-2">
          <div>
            <dt class="font-medium">{copy.api}</dt>
            <dd>{apiStatusCopy(copy, state)}</dd>
            <dd class="font-mono text-xs break-all opacity-70">{apiBaseUrl}</dd>
          </div>
          <div>
            <dt class="font-medium">{copy.graph}</dt>
            <dd>{graphIsConfigured(graphEndpoint) ? copy.configured : copy.notConfigured}</dd>
          </div>
        </dl>
      </section>
    </section>
  )
}
