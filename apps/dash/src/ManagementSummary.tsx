import { For } from 'solid-js'
import type { JSX } from 'solid-js'

import type { IssuerPassesState } from './issuer-passes-state.ts'
import type { ManagementCopy } from './management-copy.ts'

export const ManagementSummary = (props: { state: IssuerPassesState; copy: ManagementCopy }): JSX.Element => {
  const metrics = (): { label: string; value: number | undefined }[] => {
    const summary = props.state.kind === 'ready' ? props.state.data.summary : null
    return [
      { label: props.copy.totalPasses, value: summary?.total },
      { label: props.copy.activePasses, value: summary?.active },
      { label: props.copy.totalStamps, value: summary?.stamps },
      { label: props.copy.recentClaims, value: summary?.claimedLast30Days },
    ]
  }
  return (
    <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <For each={metrics()}>
        {(metric) => (
          <div class="dash-stat">
            <dt class="stat-title text-xs sm:text-sm">{metric.label}</dt>
            <dd class="stat-value text-2xl font-semibold sm:text-3xl">
              {metric.value === undefined ? '—' : metric.value.toLocaleString()}
            </dd>
          </div>
        )}
      </For>
    </dl>
  )
}
