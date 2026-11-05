import type { RevokeResponse } from '@fuda/sdk'
import { createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import type { Result } from './api.ts'
import type { DashCopy } from './copy.ts'
import { memberSnapshot } from './members-state.ts'
import type { MembersState } from './members-state.ts'
import type { MemberRowView } from './members-view.ts'
import { OnChainStatus } from './OnChainStatus.tsx'
import { RevokeDialog } from './RevokeDialog.tsx'
import { DEFAULT_RIGHTS_FILTERS, filterRights, hasRightsFilters } from './rights-filter.ts'
import type { RightsFilters } from './rights-filter.ts'
import { RightsList } from './RightsList.tsx'
import { createSingleFlight } from './single-flight.ts'

export interface RightsPageProps {
  copy: DashCopy
  graphEndpoint: string
  members: MembersState
  onRevoke: (uid: string) => Promise<Result<RevokeResponse>>
}

const fieldValue = (target: EventTarget | null): string | null =>
  target instanceof HTMLInputElement || target instanceof HTMLSelectElement ? target.value : null

export const RightsPage = (props: RightsPageProps): JSX.Element => {
  const [filters, setFilters] = createSignal<RightsFilters>(DEFAULT_RIGHTS_FILTERS)
  const [openQr, setOpenQr] = createSignal<string | null>(null)
  const [revokeTarget, setRevokeTarget] = createSignal<MemberRowView | null>(null)
  const [revokeError, setRevokeError] = createSignal<string | null>(null)
  const [revokingUid, setRevokingUid] = createSignal<string | null>(null)
  const flight = createSingleFlight<string>()
  let invoker: HTMLButtonElement | null = null
  let heading: HTMLHeadingElement | undefined
  let mounted = true
  onCleanup(() => {
    mounted = false
  })
  const snapshot = createMemo(() => memberSnapshot(props.members))
  const rows = createMemo(() => {
    const current = snapshot()
    return current === null ? [] : filterRights(current.rows, filters())
  })

  createEffect(
    on(revokeTarget, (target) => {
      if (target === null && invoker !== null) {
        // Run after the dialog's closing effect so the invoker is no longer inert.
        queueMicrotask(() => {
          if (mounted) {
            const restoring = invoker
            const canRestore = restoring !== null && restoring.isConnected && !restoring.disabled
            if (canRestore) {
              restoring.focus()
            }
            if (!canRestore || document.activeElement !== restoring) {
              heading?.focus()
            }
            invoker = null
          }
        })
      }
    }),
  )

  const cancelRevoke = (): void => {
    const target = revokeTarget()
    if (target !== null && !flight.isRunning(target.uid)) {
      setRevokeTarget(null)
      setRevokeError(null)
    }
  }

  const confirmRevoke = async (): Promise<void> => {
    const target = revokeTarget()
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
        if (mounted) {
          if (result.ok) {
            setRevokeTarget(null)
          } else if (result.status !== 401) {
            setRevokeError(result.error)
          }
        }
      } finally {
        if (mounted) {
          setRevokingUid(null)
        }
      }
    } catch (error) {
      if (mounted) {
        setRevokeError(error instanceof Error ? error.message : String(error))
      }
    }
  }

  const clearFilters = (): void => {
    setFilters(DEFAULT_RIGHTS_FILTERS)
  }

  const collection = (): JSX.Element => {
    const current = snapshot()
    if (current === null) {
      return null
    }
    if (current.rows.length === 0) {
      return <p class="rounded-box bg-base-200 p-6 text-sm">{props.copy.rights.empty}</p>
    }
    if (rows().length === 0) {
      return <p class="rounded-box bg-base-200 p-6 text-sm">{props.copy.rights.noMatches}</p>
    }
    return (
      <RightsList
        copy={props.copy.rights}
        openQr={openQr()}
        onRequestRevoke={(row, button) => {
          if (row.status === 'revoked' || flight.isRunning(row.uid)) {
            return
          }
          invoker = button
          setRevokeError(null)
          setRevokeTarget(row)
        }}
        onToggleQr={(uid) => {
          setOpenQr(openQr() === uid ? null : uid)
        }}
        revokingUid={revokingUid()}
        rows={rows()}
      />
    )
  }

  return (
    <div class="flex flex-col gap-8">
      <section class="flex flex-col gap-6" aria-labelledby="rights-title">
        <header class="dash-page-header">
          <h1
            ref={(el) => {
              heading = el
            }}
            id="rights-title"
            class="dash-page-title"
            tabIndex={-1}
          >
            {props.copy.rights.title}
          </h1>
          <p class="opacity-70">{props.copy.rights.description}</p>
        </header>
        <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label class="flex min-w-0 grow flex-col gap-1 text-sm">
            {props.copy.rights.searchLabel}
            <input
              type="search"
              class="input w-full"
              aria-label={props.copy.rights.searchLabel}
              placeholder={props.copy.rights.searchPlaceholder}
              value={filters().query}
              onInput={(event) => {
                const value = fieldValue(event.currentTarget)
                if (value !== null) {
                  setFilters({ ...filters(), query: value })
                }
              }}
            />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            {props.copy.rights.statusFilter}
            <select
              class="select"
              aria-label={props.copy.rights.statusFilter}
              value={filters().status}
              onInput={(event) => {
                const value = fieldValue(event.currentTarget)
                if (value === 'all' || value === 'active' || value === 'revoked') {
                  setFilters({ ...filters(), status: value })
                }
              }}
            >
              <option value="all">{props.copy.rights.all}</option>
              <option value="active">{props.copy.rights.active}</option>
              <option value="revoked">{props.copy.rights.revoked}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-sm">
            {props.copy.rights.levelFilter}
            <select
              class="select"
              aria-label={props.copy.rights.levelFilter}
              value={filters().level}
              onInput={(event) => {
                const value = fieldValue(event.currentTarget)
                if (value === 'all' || value === 'bearer' || value === 'signed') {
                  setFilters({ ...filters(), level: value })
                }
              }}
            >
              <option value="all">{props.copy.rights.all}</option>
              <option value="bearer">{props.copy.rights.bearer}</option>
              <option value="signed">{props.copy.rights.signed}</option>
            </select>
          </label>
          {hasRightsFilters(filters()) ? (
            <button type="button" class="btn btn-ghost" onClick={clearFilters}>
              {props.copy.rights.clearFilters}
            </button>
          ) : null}
        </div>
        {props.members.kind === 'error' ? (
          <p role="alert" class="alert alert-error">
            {`${props.copy.rights.errorPrefix}: ${props.copy.rights.errorMessage(props.members.message)}`}
          </p>
        ) : null}
        {props.members.kind === 'loading' || props.members.kind === 'idle' ? (
          <p role="status" class="text-sm opacity-70">
            {props.copy.rights.refreshing}
          </p>
        ) : null}
        {snapshot()?.stale === true ? (
          <p role="status" class="text-sm opacity-70">
            {props.copy.rights.stale}
          </p>
        ) : null}
        {collection()}
      </section>
      <section class="border-base-300 border-t pt-8" aria-label={props.copy.chain.title}>
        <OnChainStatus copy={props.copy.chain} endpoint={props.graphEndpoint} />
      </section>
      <RevokeDialog
        busy={revokingUid() !== null}
        copy={props.copy.revoke}
        error={revokeError()}
        onCancel={cancelRevoke}
        onConfirm={() => {
          void confirmRevoke()
        }}
        target={revokeTarget()}
      />
    </div>
  )
}
