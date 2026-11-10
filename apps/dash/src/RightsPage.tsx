import type { RevokeResponse } from '@fuda/sdk'
import type { ComponentChild, JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { Result } from './api.ts'
import type { DashCopy } from './copy.ts'
import type { MembersState } from './members-state.ts'
import type { MemberRowView } from './members-view.ts'
import { OnChainStatus } from './OnChainStatus.tsx'
import { RevokeDialog } from './RevokeDialog.tsx'
import { DEFAULT_RIGHTS_FILTERS, filterRights, hasRightsFilters } from './rights-filter.ts'
import type { RightsFilters } from './rights-filter.ts'
import { RightsList } from './RightsList.tsx'
import { createSingleFlight } from './single-flight.ts'
import { useLifetime } from './use-lifetime.ts'

export interface RightsPageProps {
  copy: DashCopy
  graphEndpoint: string
  members: MembersState
  onRevoke: (uid: string) => Promise<Result<RevokeResponse>>
}

const fieldValue = (target: EventTarget | null): string | null =>
  target instanceof HTMLInputElement || target instanceof HTMLSelectElement ? target.value : null

const RightsFilterBar = (props: {
  copy: DashCopy['rights']
  filters: RightsFilters
  onChange: (change: (current: RightsFilters) => RightsFilters) => void
}): JSX.Element => (
  <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
    <label class="flex min-w-0 grow flex-col gap-1 text-sm">
      {props.copy.searchLabel}
      <input
        type="search"
        class="input w-full"
        aria-label={props.copy.searchLabel}
        placeholder={props.copy.searchPlaceholder}
        value={props.filters.query}
        onInput={(event) => {
          const value = fieldValue(event.currentTarget)
          if (value !== null) {
            props.onChange((current) => ({ ...current, query: value }))
          }
        }}
      />
    </label>
    <label class="flex flex-col gap-1 text-sm">
      {props.copy.statusFilter}
      <select
        class="select"
        aria-label={props.copy.statusFilter}
        value={props.filters.status}
        onInput={(event) => {
          const value = fieldValue(event.currentTarget)
          if (value === 'all' || value === 'active' || value === 'revoked') {
            props.onChange((current) => ({ ...current, status: value }))
          }
        }}
      >
        <option value="all">{props.copy.all}</option>
        <option value="active">{props.copy.active}</option>
        <option value="revoked">{props.copy.revoked}</option>
      </select>
    </label>
    <label class="flex flex-col gap-1 text-sm">
      {props.copy.levelFilter}
      <select
        class="select"
        aria-label={props.copy.levelFilter}
        value={props.filters.level}
        onInput={(event) => {
          const value = fieldValue(event.currentTarget)
          if (value === 'all' || value === 'bearer' || value === 'signed') {
            props.onChange((current) => ({ ...current, level: value }))
          }
        }}
      >
        <option value="all">{props.copy.all}</option>
        <option value="bearer">{props.copy.bearer}</option>
        <option value="signed">{props.copy.signed}</option>
      </select>
    </label>
    {hasRightsFilters(props.filters) ? (
      <button
        type="button"
        class="btn btn-ghost"
        onClick={() => {
          props.onChange(() => DEFAULT_RIGHTS_FILTERS)
        }}
      >
        {props.copy.clearFilters}
      </button>
    ) : null}
  </div>
)

export const RightsPage = (props: RightsPageProps): JSX.Element => {
  const [filters, setFilters] = useState<RightsFilters>(DEFAULT_RIGHTS_FILTERS)
  const [openQr, setOpenQr] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<MemberRowView | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [revokingUid, setRevokingUid] = useState<string | null>(null)
  const [flight] = useState(() => createSingleFlight<string>())
  const invoker = useRef<HTMLButtonElement | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const { mounted } = useLifetime()
  const loaded = props.members.kind === 'ready' ? props.members.rows : null
  const rows = loaded === null ? [] : filterRights(loaded, filters)

  useEffect(() => {
    if (revokeTarget === null && invoker.current !== null) {
      // Run after the dialog's closing effect so the invoker is no longer inert.
      queueMicrotask(() => {
        if (mounted.current) {
          const restoring = invoker.current
          const canRestore = restoring !== null && restoring.isConnected && !restoring.disabled
          if (canRestore) {
            restoring.focus()
          }
          if (!canRestore || document.activeElement !== restoring) {
            heading.current?.focus()
          }
          invoker.current = null
        }
      })
    }
  }, [revokeTarget])

  const cancelRevoke = (): void => {
    const target = revokeTarget
    if (target !== null && !flight.isRunning(target.uid)) {
      setRevokeTarget(null)
      setRevokeError(null)
    }
  }

  const confirmRevoke = async (): Promise<void> => {
    const target = revokeTarget
    if (target === null || target.status === 'revoked') {
      return
    }
    try {
      const promise = flight.run(target.uid, async () => await props.onRevoke(target.uid))
      if (promise === null) {
        return
      }
      setRevokingUid(target.uid)
      setRevokeError(null)
      try {
        const result = await promise
        if (mounted.current) {
          if (result.ok) {
            setRevokeTarget(null)
          } else if (result.status !== 401) {
            setRevokeError(result.error)
          }
        }
      } finally {
        if (mounted.current) {
          setRevokingUid(null)
        }
      }
    } catch (error) {
      if (mounted.current) {
        setRevokeError(error instanceof Error ? error.message : String(error))
      }
    }
  }

  const collection = (): ComponentChild => {
    if (loaded === null) {
      return null
    }
    if (loaded.length === 0) {
      return <p class="rounded-box bg-base-200 p-6 text-sm">{props.copy.rights.empty}</p>
    }
    if (rows.length === 0) {
      return <p class="rounded-box bg-base-200 p-6 text-sm">{props.copy.rights.noMatches}</p>
    }
    return (
      <RightsList
        copy={props.copy.rights}
        openQr={openQr}
        onRequestRevoke={(row, button) => {
          if (row.status === 'revoked' || flight.isRunning(row.uid)) {
            return
          }
          invoker.current = button
          setRevokeError(null)
          setRevokeTarget(row)
        }}
        onToggleQr={(uid) => {
          setOpenQr((open) => (open === uid ? null : uid))
        }}
        revokingUid={revokingUid}
        rows={rows}
      />
    )
  }

  return (
    <div class="flex flex-col gap-8">
      <section class="flex flex-col gap-6" aria-labelledby="rights-title">
        <header class="dash-page-header">
          <h1 ref={heading} id="rights-title" class="dash-page-title" tabIndex={-1}>
            {props.copy.rights.title}
          </h1>
          <p class="opacity-70">{props.copy.rights.description}</p>
        </header>
        <RightsFilterBar copy={props.copy.rights} filters={filters} onChange={setFilters} />
        {props.members.kind === 'error' ? (
          <p role="alert" class="alert alert-error">
            {`${props.copy.rights.errorPrefix}: ${props.copy.rights.errorMessage(props.members.message)}`}
          </p>
        ) : null}
        {collection()}
      </section>
      <section class="border-base-300 border-t pt-8" aria-label={props.copy.chain.title}>
        <OnChainStatus copy={props.copy.chain} endpoint={props.graphEndpoint} />
      </section>
      <RevokeDialog
        busy={revokingUid !== null}
        copy={props.copy.revoke}
        error={revokeError}
        onCancel={cancelRevoke}
        onConfirm={() => {
          void confirmRevoke()
        }}
        target={revokeTarget}
      />
    </div>
  )
}
