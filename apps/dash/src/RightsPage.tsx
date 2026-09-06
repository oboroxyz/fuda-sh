/** @jsxImportSource hono/jsx/dom */
import type { RevokeResponse } from '@fuda/sdk'
import { useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

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
import type { SingleFlight } from './single-flight.ts'

export interface RightsPageProps {
  copy: DashCopy
  graphEndpoint: string
  members: MembersState
  onRevoke: (uid: string) => Promise<Result<RevokeResponse>>
}

const fieldValue = (target: EventTarget | null): string | null =>
  target instanceof HTMLInputElement || target instanceof HTMLSelectElement ? target.value : null

export const RightsPage = ({ copy, graphEndpoint, members, onRevoke }: RightsPageProps): JSX.Element => {
  const [filters, setFilters] = useState<RightsFilters>(DEFAULT_RIGHTS_FILTERS)
  const [openQr, setOpenQr] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<MemberRowView | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [revokingUid, setRevokingUid] = useState<string | null>(null)
  const flightRef = useRef<SingleFlight<string> | null>(null)
  const invokerRef = useRef<HTMLButtonElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const mounted = useRef(true)
  flightRef.current ??= createSingleFlight<string>()
  const flight = flightRef.current
  const snapshot = memberSnapshot(members)
  const rows = snapshot === null ? [] : filterRights(snapshot.rows, filters)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (revokeTarget === null && invokerRef.current !== null) {
      // Run after the dialog's closing effect so the invoker is no longer inert.
      queueMicrotask(() => {
        if (mounted.current) {
          const invoker = invokerRef.current
          const canRestore = invoker !== null && invoker.isConnected && !invoker.disabled
          if (canRestore) {
            invoker.focus()
          }
          if (!canRestore || document.activeElement !== invoker) {
            headingRef.current?.focus()
          }
          invokerRef.current = null
        }
      })
    }
  }, [revokeTarget])

  const cancelRevoke = (): void => {
    if (revokeTarget !== null && !flight.isRunning(revokeTarget.uid)) {
      setRevokeTarget(null)
      setRevokeError(null)
    }
  }

  const confirmRevoke = async (): Promise<void> => {
    if (revokeTarget === null || revokeTarget.status === 'revoked') {
      return
    }
    try {
      const promise = flight.run(revokeTarget.uid, async () => await onRevoke(revokeTarget.uid))
      if (promise === null) {
        return
      }
      setRevokingUid(revokeTarget.uid)
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

  const clearFilters = (): void => {
    setFilters(DEFAULT_RIGHTS_FILTERS)
  }

  const collection = (): JSX.Element | null => {
    if (snapshot === null) {
      return null
    }
    if (snapshot.rows.length === 0) {
      return <p class="rounded-box bg-base-200 p-6 text-sm">{copy.rights.empty}</p>
    }
    if (rows.length === 0) {
      return <p class="rounded-box bg-base-200 p-6 text-sm">{copy.rights.noMatches}</p>
    }
    return (
      <RightsList
        copy={copy.rights}
        openQr={openQr}
        onRequestRevoke={(row, invoker) => {
          if (row.status === 'revoked' || flight.isRunning(row.uid)) {
            return
          }
          invokerRef.current = invoker
          setRevokeError(null)
          setRevokeTarget(row)
        }}
        onToggleQr={(uid) => {
          setOpenQr(openQr === uid ? null : uid)
        }}
        revokingUid={revokingUid}
        rows={rows}
      />
    )
  }

  return (
    <div class="flex flex-col gap-8">
      <section class="flex flex-col gap-4" aria-labelledby="rights-title">
        <header>
          <h1 ref={headingRef} id="rights-title" class="text-2xl font-bold" tabIndex={-1}>
            {copy.rights.title}
          </h1>
          <p class="opacity-70">{copy.rights.description}</p>
        </header>
        <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label class="flex min-w-0 grow flex-col gap-1 text-sm">
            {copy.rights.searchLabel}
            <input
              type="search"
              class="input w-full"
              aria-label={copy.rights.searchLabel}
              placeholder={copy.rights.searchPlaceholder}
              value={filters.query}
              onInput={(event) => {
                const value = fieldValue(event.currentTarget)
                if (value !== null) {
                  setFilters({ ...filters, query: value })
                }
              }}
            />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            {copy.rights.statusFilter}
            <select
              class="select"
              aria-label={copy.rights.statusFilter}
              value={filters.status}
              onInput={(event) => {
                const value = fieldValue(event.currentTarget)
                if (value === 'all' || value === 'active' || value === 'revoked') {
                  setFilters({ ...filters, status: value })
                }
              }}
            >
              <option value="all">{copy.rights.all}</option>
              <option value="active">{copy.rights.active}</option>
              <option value="revoked">{copy.rights.revoked}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-sm">
            {copy.rights.levelFilter}
            <select
              class="select"
              aria-label={copy.rights.levelFilter}
              value={filters.level}
              onInput={(event) => {
                const value = fieldValue(event.currentTarget)
                if (value === 'all' || value === 'bearer' || value === 'signed' || value === 'private') {
                  setFilters({ ...filters, level: value })
                }
              }}
            >
              <option value="all">{copy.rights.all}</option>
              <option value="bearer">{copy.rights.bearer}</option>
              <option value="signed">{copy.rights.signed}</option>
              <option value="private">{copy.rights.private}</option>
            </select>
          </label>
          {hasRightsFilters(filters) ? (
            <button type="button" class="btn btn-ghost" onClick={clearFilters}>
              {copy.rights.clearFilters}
            </button>
          ) : null}
        </div>
        {members.kind === 'error' ? (
          <p role="alert" class="alert alert-error">
            {members.message}
          </p>
        ) : null}
        {members.kind === 'loading' || members.kind === 'idle' ? (
          <p role="status" class="text-sm opacity-70">
            {copy.rights.refreshing}
          </p>
        ) : null}
        {collection()}
      </section>
      <section class="border-base-300 border-t pt-8" aria-label={copy.chain.title}>
        <OnChainStatus copy={copy.chain} endpoint={graphEndpoint} />
      </section>
      <RevokeDialog
        busy={revokingUid !== null}
        copy={copy.revoke}
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
