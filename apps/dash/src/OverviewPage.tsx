import type { JSX } from 'solid-js'

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

export const OverviewPage = (props: OverviewPageProps): JSX.Element => {
  const snapshot = (): ReturnType<typeof memberSnapshot> => memberSnapshot(props.state)
  const initialLoading = (): boolean => props.state.kind === 'loading' && snapshot() === null
  const counts = (): ReturnType<typeof countMembers> | null => {
    const current = snapshot()
    return current === null ? null : countMembers(current.rows)
  }
  const stateMessage = (): string | null => {
    const current = snapshot()
    if (current === null) {
      return null
    }
    if (current.refreshing) {
      return props.copy.refreshing
    }
    return current.stale ? props.copy.stale : null
  }
  const errorMessage = (): string | null =>
    props.state.kind === 'error' ? `${props.copy.errorPrefix}: ${props.state.message}` : null

  const countValue = (value: number | null): JSX.Element => {
    if (value !== null) {
      return String(value)
    }
    if (initialLoading()) {
      return (
        <span aria-hidden="true" class="dash-skeleton">
          …
        </span>
      )
    }
    return '—'
  }

  return (
    <section class="flex flex-col gap-6">
      <header class="dash-page-header">
        <h1 class="dash-page-title">{props.copy.title}</h1>
        <p class="opacity-70">{props.copy.description}</p>
      </header>

      <section class="flex flex-col gap-3" aria-label={props.copy.title}>
        {errorMessage() === null ? null : (
          <p role="alert" class="alert alert-error">
            {errorMessage()}
          </p>
        )}
        {stateMessage() === null ? null : <p class="text-sm opacity-70">{stateMessage()}</p>}
        <div class="dash-overview-cards">
          <div class="dash-stat">
            <div class="stat-title">{props.copy.total}</div>
            <div class="stat-value">{countValue(counts()?.total ?? null)}</div>
          </div>
          <div class="dash-stat">
            <div class="stat-title">{props.copy.active}</div>
            <div class="stat-value">{countValue(counts()?.active ?? null)}</div>
          </div>
          <div class="dash-stat">
            <div class="stat-title">{props.copy.revoked}</div>
            <div class="stat-value">{countValue(counts()?.revoked ?? null)}</div>
          </div>
        </div>
        {initialLoading() ? (
          <p aria-live="polite" class="sr-only">
            {props.copy.checking}
          </p>
        ) : null}
      </section>

      <section class="card bg-base-200 p-4">
        <dl class="grid gap-4 sm:grid-cols-2">
          <div>
            <dt class="font-medium">{props.copy.api}</dt>
            <dd>{apiStatusCopy(props.copy, props.state)}</dd>
            <dd class="font-mono text-xs break-all opacity-70">{props.apiBaseUrl}</dd>
          </div>
          <div>
            <dt class="font-medium">{props.copy.graph}</dt>
            <dd>
              {graphIsConfigured(props.graphEndpoint) ? props.copy.configured : props.copy.notConfigured}
            </dd>
            {graphIsConfigured(props.graphEndpoint) ? (
              <dd class="font-mono text-xs break-all opacity-70">{props.graphEndpoint}</dd>
            ) : null}
          </div>
        </dl>
      </section>
    </section>
  )
}
