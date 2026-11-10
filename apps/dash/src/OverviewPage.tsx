import type { JSX } from 'preact'

import type { DashCopy } from './copy.ts'
import { countMembers, graphIsConfigured } from './members-state.ts'
import type { MembersState } from './members-state.ts'

export interface OverviewPageProps {
  apiBaseUrl: string
  copy: DashCopy['overview']
  graphEndpoint: string
  state: MembersState
}

const countValue = (value: number | undefined): string => (value === undefined ? '—' : String(value))

export const OverviewPage = (props: OverviewPageProps): JSX.Element => {
  const counts = props.state.kind === 'ready' ? countMembers(props.state.rows) : null

  return (
    <section class="flex flex-col gap-6">
      <header class="dash-page-header">
        <h1 class="dash-page-title">{props.copy.title}</h1>
        <p class="opacity-70">{props.copy.description}</p>
      </header>

      <section class="flex flex-col gap-3" aria-label={props.copy.title}>
        {props.state.kind === 'error' ? (
          <p role="alert" class="alert alert-error">
            {`${props.copy.errorPrefix}: ${props.copy.errorMessage(props.state.message)}`}
          </p>
        ) : null}
        <div class="dash-overview-cards">
          <div class="dash-stat">
            <div class="stat-title">{props.copy.total}</div>
            <div class="stat-value">{countValue(counts?.total)}</div>
          </div>
          <div class="dash-stat">
            <div class="stat-title">{props.copy.active}</div>
            <div class="stat-value">{countValue(counts?.active)}</div>
          </div>
          <div class="dash-stat">
            <div class="stat-title">{props.copy.revoked}</div>
            <div class="stat-value">{countValue(counts?.revoked)}</div>
          </div>
        </div>
      </section>

      <section class="card bg-base-200 p-4">
        <dl class="grid gap-4 sm:grid-cols-2">
          <div>
            <dt class="font-medium">{props.copy.api}</dt>
            <dd>{props.state.kind === 'ready' ? props.copy.connected : props.copy.unavailable}</dd>
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
