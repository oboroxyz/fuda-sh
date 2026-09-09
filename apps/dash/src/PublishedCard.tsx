/** @jsxImportSource hono/jsx/dom */
import type { CardCategory, CardView, IssuerView } from '@fuda/sdk'
import { useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { cardUrl, displayUrl } from './card-designer.ts'
import { cardClaimText, cardValidityText } from './card-display.ts'
import type { DashCopy } from './copy.ts'
import { useIssuerPasses } from './issuer-passes-state.ts'
import type { PassesLoad } from './issuer-passes-state.ts'
import type { ManagementCopy } from './management-copy.ts'
import { ManagementSummary } from './ManagementSummary.tsx'
import { cardEditPath, cardSettingsPath } from './router.ts'
import type { DashRoute } from './router.ts'
import { useCopyText } from './use-copy-text.ts'

export interface PublishedCardProps {
  canAddCard: boolean
  cards: CardView[]
  copy: DashCopy['published']
  managementCopy: ManagementCopy
  issuer: IssuerView
  loadPasses: PassesLoad
  onAddCard: () => void
  onSettings: (cardId: string) => void
  onVenue: () => void
  onNavigate: (route: DashRoute) => void
  publicUrl: string
}

const MS_PER_SECOND = 1000

export const PublishedCard = ({
  cards,
  copy,
  managementCopy: labels,
  loadPasses,
  ...props
}: PublishedCardProps): JSX.Element => {
  const { state, refresh } = useIssuerPasses(loadPasses, { page: 1, pageSize: 1 })
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<CardCategory | 'all'>('all')
  const clipboard = useCopyText()
  const needle = search.trim().toLocaleLowerCase()
  const filtered = cards.filter(
    (card) =>
      (category === 'all' || card.category === category) &&
      `${card.title} ${card.id} ${card.slug}`.toLocaleLowerCase().includes(needle),
  )
  const now = Math.floor(Date.now() / MS_PER_SECOND)
  const clear = (): void => {
    setSearch('')
    setCategory('all')
  }
  return (
    <section class="dash-page flex min-w-0 flex-col gap-6">
      <header class="dash-page-header">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h1 class="dash-page-title">{copy.title}</h1>
          {props.canAddCard ? (
            <a
              class="link link-hover inline-flex min-h-11 items-center text-sm"
              href="/cards/new"
              onClick={(event) => {
                if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
                  return
                }
                event.preventDefault()
                props.onAddCard()
              }}
            >
              {copy.addCard}
            </a>
          ) : null}
        </div>
        <p class="text-[var(--fuda-muted)]">{copy.description}</p>
      </header>
      <ManagementSummary state={state} copy={labels} />
      {state.kind === 'failed' ? (
        <div role="alert" class="flex flex-wrap items-center gap-3 text-sm">
          <span>{labels.loadFailed}</span>
          <button class="btn btn-sm" type="button" onClick={refresh}>
            {labels.retry}
          </button>
        </div>
      ) : null}
      {state.kind === 'loading' ? (
        <p class="text-sm text-[var(--fuda-muted)]" role="status">
          {labels.loading}
        </p>
      ) : null}
      {state.kind === 'ready' && state.data.summary.unknown > 0 ? (
        <p class="text-sm text-[var(--fuda-muted)]">
          {labels.unknownHint.replace('{count}', String(state.data.summary.unknown))}
        </p>
      ) : null}
      {cards.length > 0 ? (
        <div class="card overflow-hidden">
          <div class="flex flex-wrap items-end gap-3 border-b border-[var(--fuda-border)] p-4">
            <label class="flex min-w-0 flex-1 basis-52 flex-col gap-1.5 text-sm">
              <span>{labels.searchCards}</span>
              <input
                class="input w-full"
                type="search"
                value={search}
                placeholder={labels.searchCardsPlaceholder}
                onInput={(event) => {
                  if (event.currentTarget instanceof HTMLInputElement) {
                    setSearch(event.currentTarget.value)
                  }
                }}
              />
            </label>
            <label class="flex flex-col gap-1.5 text-sm">
              <span>{labels.type}</span>
              <select
                class="select min-w-40"
                value={category}
                onChange={(event) => {
                  if (event.currentTarget instanceof HTMLSelectElement) {
                    const { value } = event.currentTarget
                    setCategory(value === 'membership' || value === 'ticket' ? value : 'all')
                  }
                }}
              >
                <option value="all">{labels.allTypes}</option>
                <option value="membership">{labels.membership}</option>
                <option value="ticket">{labels.ticket}</option>
              </select>
            </label>
            <button class="btn btn-sm" type="button" disabled={state.kind === 'loading'} onClick={refresh}>
              {labels.refresh}
            </button>
          </div>
          {filtered.length === 0 ? (
            <div class="flex flex-col items-start gap-3 p-6">
              <p role="status">{labels.noCardsMatch}</p>
              <button class="btn btn-sm" type="button" onClick={clear}>
                {labels.clearFilters}
              </button>
            </div>
          ) : (
            <div
              class="dash-management-table overflow-x-auto"
              role="region"
              aria-label={copy.title}
              tabIndex={0}
            >
              <table class="table w-full min-w-190 text-sm">
                <thead>
                  <tr>
                    <th scope="col">{labels.card}</th>
                    <th scope="col" class="text-right">
                      {labels.issued}
                    </th>
                    <th scope="col" class="text-right">
                      {labels.active}
                    </th>
                    <th scope="col">{labels.type}</th>
                    <th scope="col">{labels.validity}</th>
                    <th scope="col">{labels.url}</th>
                    <th scope="col">
                      <span class="sr-only">{labels.actions}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((card): JSX.Element => {
                    const url = cardUrl(props.publicUrl, card.slug)
                    const stats =
                      state.kind === 'ready'
                        ? (state.data.cardStats.find((entry) => entry.cardId === card.id) ?? {
                            active: 0,
                            issued: 0,
                          })
                        : null
                    return (
                      <tr key={card.id}>
                        <th scope="row" class="min-w-40 font-normal">
                          <a
                            class="link link-hover font-semibold"
                            href={cardSettingsPath(card)}
                            onClick={(event) => {
                              if (
                                event.button !== 0 ||
                                event.altKey ||
                                event.ctrlKey ||
                                event.metaKey ||
                                event.shiftKey
                              ) {
                                return
                              }
                              event.preventDefault()
                              props.onNavigate(cardSettingsPath(card))
                            }}
                          >
                            {card.title || card.id}
                          </a>
                          <p class="mt-1 font-mono text-xs text-[var(--fuda-muted)]">{card.slug}</p>
                        </th>
                        <td class="text-right tabular-nums">{stats?.issued.toLocaleString() ?? '—'}</td>
                        <td class="text-right tabular-nums">{stats?.active.toLocaleString() ?? '—'}</td>
                        <td>
                          <span class="badge badge-ghost whitespace-nowrap">
                            {card.category === 'membership' ? labels.membership : labels.ticket}
                          </span>
                        </td>
                        <td class="max-w-64 min-w-44">
                          <p>{cardClaimText(copy, card, now)}</p>
                          <p class="mt-1 text-xs text-[var(--fuda-muted)]">{cardValidityText(copy, card)}</p>
                        </td>
                        <td class="max-w-64 min-w-44">
                          <a
                            class="link link-hover font-mono text-xs"
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {displayUrl(url)}
                          </a>
                          <button
                            class="link link-hover mt-1 block min-h-8 text-xs"
                            type="button"
                            onClick={() => {
                              clipboard.copy(url)
                            }}
                          >
                            {clipboard.copied === url ? copy.copied : copy.copy}
                          </button>
                        </td>
                        <td>
                          <a
                            class="link link-hover inline-flex min-h-11 items-center"
                            href={cardEditPath(card)}
                            onClick={(event) => {
                              if (
                                event.button !== 0 ||
                                event.altKey ||
                                event.ctrlKey ||
                                event.metaKey ||
                                event.shiftKey
                              ) {
                                return
                              }
                              event.preventDefault()
                              props.onSettings(card.id)
                            }}
                          >
                            {labels.edit}
                          </a>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p class="border-t border-[var(--fuda-border)] px-4 py-3 text-xs text-[var(--fuda-muted)]">
            {labels.results.replace('{count}', String(filtered.length))}
          </p>
        </div>
      ) : (
        <div class="card flex flex-col items-start gap-4 p-6">
          <p>{props.canAddCard ? copy.createFirst : copy.manageVenue}</p>
          <button
            class="btn btn-primary"
            onClick={props.canAddCard ? props.onAddCard : props.onVenue}
            type="button"
          >
            {props.canAddCard ? copy.addCard : copy.manageVenue}
          </button>
        </div>
      )}
      {clipboard.failed === null ? null : (
        <p class="text-error text-sm" role="alert">
          {labels.copyFailed}
        </p>
      )}
      <p class="text-xs text-[var(--fuda-muted)]">{labels.snapshotHint}</p>
    </section>
  )
}
