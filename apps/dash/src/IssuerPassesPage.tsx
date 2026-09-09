/** @jsxImportSource hono/jsx/dom */
import { formatMemberNumber } from '@fuda/sdk'
import type { CardView, IssuerPassStatus, IssuerPassView } from '@fuda/sdk'
import { useEffect, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { formatInstant } from './card-designer.ts'
import { useIssuerPasses } from './issuer-passes-state.ts'
import type { PassesLoad } from './issuer-passes-state.ts'
import type { PassQuery } from './management-api.ts'
import type { ManagementCopy } from './management-copy.ts'
import { ManagementSummary } from './ManagementSummary.tsx'

const PAGE_SIZE = 25
const SEARCH_DELAY_MS = 250
const STATUSES: readonly IssuerPassStatus[] = [
  'active',
  'not_yet_valid',
  'expired',
  'consumed',
  'revoked',
  'unknown',
]

const expiryText = (pass: IssuerPassView, copy: ManagementCopy): string => {
  if (pass.validUntil === null) {
    return copy.notRecorded
  }
  return pass.validUntil === 0 ? copy.noExpiry : formatInstant(pass.validUntil)
}

const PassTable = ({ passes, copy }: { passes: IssuerPassView[]; copy: ManagementCopy }): JSX.Element => (
  <div class="dash-management-table overflow-x-auto" role="region" aria-label={copy.passesTitle} tabIndex={0}>
    <table class="table w-full min-w-210 text-sm">
      <thead>
        <tr>
          <th scope="col">{copy.member}</th>
          <th scope="col">{copy.card}</th>
          <th scope="col">{copy.claimedAt}</th>
          <th scope="col" class="text-right">
            {copy.stamps}
          </th>
          <th scope="col">{copy.status}</th>
          <th scope="col">{copy.expires}</th>
          <th scope="col">{copy.address}</th>
        </tr>
      </thead>
      <tbody>
        {passes.map((pass): JSX.Element => (
          <tr key={pass.uid}>
            <th scope="row" class="min-w-44 font-normal">
              <p class="font-mono font-medium">
                {pass.memberNumber === '' ? pass.uid : formatMemberNumber(pass.memberNumber)}
              </p>
              {pass.memberNumber === '' ? null : (
                <p class="mt-1 font-mono text-xs text-[var(--fuda-muted)]" title={pass.uid}>
                  {pass.uid.slice(0, 10)}…{pass.uid.slice(-6)}
                </p>
              )}
            </th>
            <td class="max-w-48 min-w-36">{pass.card?.title ?? copy.notRecorded}</td>
            <td class="min-w-36 text-xs whitespace-nowrap">{formatInstant(pass.claimedAt)}</td>
            <td class="text-right tabular-nums">{pass.stamps.toLocaleString()}</td>
            <td>
              <span class="badge badge-ghost whitespace-nowrap">{copy.statuses[pass.status]}</span>
            </td>
            <td class="min-w-32 text-xs whitespace-nowrap">{expiryText(pass, copy)}</td>
            <td class="max-w-56 min-w-40">
              <code class="text-xs">{pass.holder ?? copy.notRecorded}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

export const IssuerPassesPage = ({
  cards,
  copy,
  load,
}: {
  cards: CardView[]
  copy: ManagementCopy
  load: PassesLoad
}): JSX.Element => {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState<PassQuery>({ page: 1, pageSize: PAGE_SIZE })
  const { state, refresh } = useIssuerPasses(load, query)
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = search.trim()
      setQuery((current) => ((current.q ?? '') === q ? current : { ...current, page: 1, q }))
    }, SEARCH_DELAY_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [search])

  const pages =
    state.kind === 'ready' ? Math.max(1, Math.ceil(state.data.page.total / PAGE_SIZE)) : query.page
  useEffect(() => {
    if (state.kind === 'ready' && query.page > pages) {
      setQuery((current) => ({ ...current, page: pages }))
    }
  }, [state.kind, pages, query.page])
  const clear = (): void => {
    setSearch('')
    setQuery({ page: 1, pageSize: PAGE_SIZE })
  }

  return (
    <section class="dash-page flex min-w-0 flex-col gap-6">
      <header class="dash-page-header">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h1 class="dash-page-title">{copy.passesTitle}</h1>
          <button class="btn btn-sm" type="button" disabled={state.kind === 'loading'} onClick={refresh}>
            {copy.refresh}
          </button>
        </div>
        <p class="text-[var(--fuda-muted)]">{copy.passesDescription}</p>
      </header>
      <ManagementSummary state={state} copy={copy} />
      <div class="space-y-1 text-xs text-[var(--fuda-muted)]">
        <p>{copy.countHint}</p>
        {state.kind === 'ready' && state.data.summary.unknown > 0 ? (
          <p>{copy.unknownHint.replace('{count}', String(state.data.summary.unknown))}</p>
        ) : null}
      </div>
      <div class="card overflow-hidden">
        <div class="flex flex-wrap items-end gap-3 border-b border-[var(--fuda-border)] p-4">
          <label class="flex min-w-0 flex-1 basis-56 flex-col gap-1.5 text-sm">
            <span>{copy.searchPasses}</span>
            <input
              class="input w-full"
              type="search"
              value={search}
              maxLength={120}
              placeholder={copy.searchPassesPlaceholder}
              onInput={(event) => {
                if (event.currentTarget instanceof HTMLInputElement) {
                  setSearch(event.currentTarget.value)
                }
              }}
            />
          </label>
          <label class="flex min-w-0 flex-col gap-1.5 text-sm">
            <span>{copy.card}</span>
            <select
              class="select max-w-full sm:max-w-52"
              name="cardId"
              value={query.cardId ?? ''}
              onChange={(event) => {
                if (event.currentTarget instanceof HTMLSelectElement) {
                  const cardId = event.currentTarget.value
                  setQuery((current) => ({ ...current, cardId, page: 1 }))
                }
              }}
            >
              <option value="">{copy.allCards}</option>
              {cards.map((card): JSX.Element => (
                <option key={card.id} value={card.id}>
                  {card.title}
                </option>
              ))}
            </select>
          </label>
          <label class="flex flex-col gap-1.5 text-sm">
            <span>{copy.status}</span>
            <select
              class="select"
              name="status"
              value={query.status ?? ''}
              onChange={(event) => {
                if (event.currentTarget instanceof HTMLSelectElement) {
                  const { value } = event.currentTarget
                  const status = STATUSES.find((candidate) => candidate === value)
                  setQuery((current) => ({ ...current, page: 1, status }))
                }
              }}
            >
              <option value="">{copy.allStatuses}</option>
              {STATUSES.map((status): JSX.Element => (
                <option key={status} value={status}>
                  {copy.statuses[status]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {state.kind === 'loading' ? (
          <p class="p-6 text-sm" role="status">
            {copy.loading}
          </p>
        ) : null}
        {state.kind === 'failed' ? (
          <div role="alert" class="flex flex-wrap items-center gap-3 p-6 text-sm">
            <p>{copy.loadFailed}</p>
            <button class="btn btn-sm" type="button" onClick={refresh}>
              {copy.retry}
            </button>
          </div>
        ) : null}
        {state.kind === 'ready' ? (
          <>
            {state.data.passes.length === 0 ? (
              <div class="flex flex-col items-start gap-3 p-6">
                <p role="status">{state.data.summary.total === 0 ? copy.noPasses : copy.noPassesMatch}</p>
                {state.data.summary.total === 0 ? null : (
                  <button class="btn btn-sm" type="button" onClick={clear}>
                    {copy.clearFilters}
                  </button>
                )}
              </div>
            ) : (
              <PassTable passes={state.data.passes} copy={copy} />
            )}
            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--fuda-border)] px-4 py-3 text-xs">
              <p class="text-[var(--fuda-muted)]">
                {copy.results.replace('{count}', state.data.page.total.toLocaleString())}
              </p>
              <div class="flex flex-wrap items-center gap-3">
                <p>{copy.page.replace('{page}', String(query.page)).replace('{pages}', String(pages))}</p>
                <button
                  class="btn btn-sm"
                  type="button"
                  disabled={query.page <= 1}
                  onClick={() => {
                    setQuery((current) => ({ ...current, page: current.page - 1 }))
                  }}
                >
                  {copy.previous}
                </button>
                <button
                  class="btn btn-sm"
                  type="button"
                  disabled={query.page >= pages}
                  onClick={() => {
                    setQuery((current) => ({ ...current, page: current.page + 1 }))
                  }}
                >
                  {copy.next}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
      <div class="space-y-1 text-xs text-[var(--fuda-muted)]">
        <p>{copy.localTime}</p>
        <p>{copy.snapshotHint}</p>
      </div>
    </section>
  )
}
