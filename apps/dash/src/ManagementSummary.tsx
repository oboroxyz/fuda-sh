/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { IssuerPassesState } from './issuer-passes-state.ts'
import type { ManagementCopy } from './management-copy.ts'

export const ManagementSummary = ({
  state,
  copy,
}: {
  state: IssuerPassesState
  copy: ManagementCopy
}): JSX.Element => {
  const summary = state.kind === 'ready' ? state.data.summary : null
  const metrics = [
    { label: copy.totalPasses, value: summary?.total },
    { label: copy.activePasses, value: summary?.active },
    { label: copy.totalStamps, value: summary?.stamps },
    { label: copy.recentClaims, value: summary?.claimedLast30Days },
  ]
  return (
    <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {metrics.map((metric): JSX.Element => (
        <div class="dash-stat" key={metric.label}>
          <dt class="stat-title text-xs sm:text-sm">{metric.label}</dt>
          <dd class="stat-value text-2xl font-semibold sm:text-3xl">
            {metric.value === undefined ? '—' : metric.value.toLocaleString()}
          </dd>
        </div>
      ))}
    </dl>
  )
}
