import type { CardCategory, CardView, IssuerPassesResponse, IssuerView } from '@fuda/sdk'
import { createMemo, createSignal, For } from 'solid-js'
import type { JSX } from 'solid-js'

import { cardUrl, displayUrl } from './card-designer.ts'
import { cardClaimText, cardValidityText } from './card-display.ts'
import type { DashCopy } from './copy.ts'
import { createIssuerPasses } from './issuer-passes-state.ts'
import type { PassesLoad } from './issuer-passes-state.ts'
import type { ManagementCopy } from './management-copy.ts'
import { ManagementSummary } from './ManagementSummary.tsx'
import { cardEditPath, cardSettingsPath } from './router.ts'
import type { DashRoute } from './router.ts'
import { createCopyText } from './use-copy-text.ts'

export interface PublishedCardProps {
  cards: CardView[]
  copy: DashCopy['published']
  managementCopy: ManagementCopy
  issuer: IssuerView
  loadPasses: PassesLoad
  onAddCard: () => void
  onDefaultCard: (slug: string | null) => Promise<boolean>
  onSettings: (cardId: string) => void
  onNavigate: (route: DashRoute) => void
  publicUrl: string
}

const MS_PER_SECOND = 1000

type DefaultSave =
  | { kind: 'idle' }
  | { kind: 'saving'; slug: string | null }
  | { kind: 'saved' }
  | { kind: 'failed' }

const isPlainClick = (event: MouseEvent): boolean =>
  event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey

export const PublishedCard = (props: PublishedCardProps): JSX.Element => {
  const { state, refresh } = createIssuerPasses(props.loadPasses, () => ({ page: 1, pageSize: 1 }))
  const [search, setSearch] = createSignal('')
  const [category, setCategory] = createSignal<CardCategory | 'all'>('all')
  const [defaultSave, setDefaultSave] = createSignal<DefaultSave>({ kind: 'idle' })
  let defaultSavePending = false
  const clipboard = createCopyText()
  const labels = (): ManagementCopy => props.managementCopy
  const filtered = createMemo(() => {
    const needle = search().trim().toLocaleLowerCase()
    return props.cards.filter(
      (card) =>
        (category() === 'all' || card.category === category()) &&
        `${card.title} ${card.id} ${card.slug}`.toLocaleLowerCase().includes(needle),
    )
  })
  const ready = (): IssuerPassesResponse | null => {
    const current = state()
    return current.kind === 'ready' ? current.data : null
  }
  const now = Math.floor(Date.now() / MS_PER_SECOND)
  const clear = (): void => {
    setSearch('')
    setCategory('all')
  }
  const storeUrl = (): string => `${props.publicUrl.replace(/\/$/u, '')}/home`
  const saveDefault = (slug: string | null): void => {
    if (defaultSavePending) {
      return
    }
    defaultSavePending = true
    setDefaultSave({ kind: 'saving', slug })
    const run = async (): Promise<void> => {
      let saved = false
      try {
        saved = await props.onDefaultCard(slug)
      } catch {
        saved = false
      }
      defaultSavePending = false
      setDefaultSave(saved ? { kind: 'saved' } : { kind: 'failed' })
    }
    void run()
  }
  const cardRow = (card: CardView): JSX.Element => {
    const url = (): string => cardUrl(props.publicUrl, card.slug)
    const isDefault = (): boolean => props.issuer.defaultCardSlug === card.slug
    const nextDefault = (): string | null => (isDefault() ? null : card.slug)
    const defaultAction = (): string => {
      const save = defaultSave()
      if (save.kind === 'saving' && save.slug === nextDefault()) {
        return props.copy.defaultSaving
      }
      return isDefault() ? props.copy.clearDefault : props.copy.setDefault
    }
    const stats = (): { active: number; issued: number } | null => {
      const data = ready()
      return data === null
        ? null
        : (data.cardStats.find((entry) => entry.cardId === card.id) ?? { active: 0, issued: 0 })
    }
    return (
      <tr>
        <th scope="row" class="min-w-40 font-normal">
          <a
            class="link link-hover font-semibold"
            href={cardSettingsPath(card)}
            onClick={(event) => {
              if (!isPlainClick(event)) {
                return
              }
              event.preventDefault()
              props.onNavigate(cardSettingsPath(card))
            }}
          >
            {card.title || card.id}
          </a>
          {isDefault() ? (
            <span class="badge badge-primary mt-2 whitespace-nowrap">{props.copy.defaultBadge}</span>
          ) : null}
          <p class="mt-1 font-mono text-xs text-[var(--fuda-muted)]">{card.slug}</p>
        </th>
        <td class="text-right tabular-nums">{stats()?.issued.toLocaleString() ?? '—'}</td>
        <td class="text-right tabular-nums">{stats()?.active.toLocaleString() ?? '—'}</td>
        <td>
          <span class="badge badge-ghost whitespace-nowrap">
            {card.category === 'membership' ? labels().membership : labels().ticket}
          </span>
        </td>
        <td class="max-w-64 min-w-44">
          <p>{cardClaimText(props.copy, card, now)}</p>
          <p class="mt-1 text-xs text-[var(--fuda-muted)]">{cardValidityText(props.copy, card)}</p>
        </td>
        <td class="max-w-64 min-w-44">
          <a class="link link-hover font-mono text-xs" href={url()} target="_blank" rel="noopener noreferrer">
            {displayUrl(url())}
          </a>
          <button
            class="link link-hover mt-1 block min-h-8 text-xs"
            type="button"
            onClick={() => {
              clipboard.copy(url())
            }}
          >
            {clipboard.copied() === url() ? props.copy.copied : props.copy.copy}
          </button>
        </td>
        <td>
          <div class="flex min-w-28 flex-col items-start gap-1">
            <a
              class="link link-hover inline-flex min-h-11 items-center"
              href={cardEditPath(card)}
              onClick={(event) => {
                if (!isPlainClick(event)) {
                  return
                }
                event.preventDefault()
                props.onSettings(card.id)
              }}
            >
              {labels().edit}
            </a>
            <button
              aria-pressed={isDefault() ? 'true' : 'false'}
              class="link link-hover inline-flex min-h-11 items-center text-left"
              disabled={defaultSave().kind === 'saving'}
              type="button"
              onClick={() => {
                saveDefault(nextDefault())
              }}
            >
              {defaultAction()}
            </button>
          </div>
        </td>
      </tr>
    )
  }
  return (
    <section class="dash-page flex min-w-0 flex-col gap-6">
      <header class="dash-page-header">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h1 class="dash-page-title">{props.copy.title}</h1>
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
            {props.copy.addCard}
          </a>
        </div>
        <p class="text-[var(--fuda-muted)]">{props.copy.description}</p>
        <a
          class="link link-hover inline-flex min-h-11 items-center self-start text-sm"
          href={storeUrl()}
          target="_blank"
          rel="noopener noreferrer"
        >
          {props.copy.storeDisplay}
        </a>
      </header>
      <ManagementSummary state={state()} copy={labels()} />
      {state().kind === 'failed' ? (
        <div role="alert" class="flex flex-wrap items-center gap-3 text-sm">
          <span>{labels().loadFailed}</span>
          <button class="btn btn-sm" type="button" onClick={refresh}>
            {labels().retry}
          </button>
        </div>
      ) : null}
      {state().kind === 'loading' ? (
        <p class="text-sm text-[var(--fuda-muted)]" role="status">
          {labels().loading}
        </p>
      ) : null}
      {(ready()?.summary.unknown ?? 0) > 0 ? (
        <p class="text-sm text-[var(--fuda-muted)]">
          {labels().unknownHint.replace('{count}', String(ready()?.summary.unknown ?? 0))}
        </p>
      ) : null}
      {props.cards.length > 0 ? (
        <div class="card overflow-hidden">
          <div class="flex flex-wrap items-end gap-3 border-b border-[var(--fuda-border)] p-4">
            <label class="flex min-w-0 flex-1 basis-52 flex-col gap-1.5 text-sm">
              <span>{labels().searchCards}</span>
              <input
                class="input w-full"
                type="search"
                value={search()}
                placeholder={labels().searchCardsPlaceholder}
                onInput={(event) => {
                  setSearch(event.currentTarget.value)
                }}
              />
            </label>
            <label class="flex flex-col gap-1.5 text-sm">
              <span>{labels().type}</span>
              <select
                class="select min-w-40"
                value={category()}
                onInput={(event) => {
                  const { value } = event.currentTarget
                  setCategory(value === 'membership' || value === 'ticket' ? value : 'all')
                }}
              >
                <option value="all">{labels().allTypes}</option>
                <option value="membership">{labels().membership}</option>
                <option value="ticket">{labels().ticket}</option>
              </select>
            </label>
            <button class="btn btn-sm" type="button" disabled={state().kind === 'loading'} onClick={refresh}>
              {labels().refresh}
            </button>
          </div>
          {filtered().length === 0 ? (
            <div class="flex flex-col items-start gap-3 p-6">
              <p role="status">{labels().noCardsMatch}</p>
              <button class="btn btn-sm" type="button" onClick={clear}>
                {labels().clearFilters}
              </button>
            </div>
          ) : (
            <div
              class="dash-management-table overflow-x-auto"
              role="region"
              aria-label={props.copy.title}
              tabIndex={0}
            >
              <table class="table w-full min-w-190 text-sm">
                <thead>
                  <tr>
                    <th scope="col">{labels().card}</th>
                    <th scope="col" class="text-right">
                      {labels().issued}
                    </th>
                    <th scope="col" class="text-right">
                      {labels().active}
                    </th>
                    <th scope="col">{labels().type}</th>
                    <th scope="col">{labels().validity}</th>
                    <th scope="col">{labels().url}</th>
                    <th scope="col">
                      <span class="sr-only">{labels().actions}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={filtered()}>{(card) => cardRow(card)}</For>
                </tbody>
              </table>
            </div>
          )}
          <p class="border-t border-[var(--fuda-border)] px-4 py-3 text-xs text-[var(--fuda-muted)]">
            {labels().results.replace('{count}', String(filtered().length))}
          </p>
        </div>
      ) : (
        <div class="card flex flex-col items-start gap-4 p-6">
          <p>{props.copy.createFirst}</p>
          <button
            class="btn btn-primary"
            onClick={() => {
              props.onAddCard()
            }}
            type="button"
          >
            {props.copy.addCard}
          </button>
        </div>
      )}
      {defaultSave().kind === 'saved' ? (
        <p class="text-sm" role="status">
          {props.copy.defaultSaved}
        </p>
      ) : null}
      {defaultSave().kind === 'failed' ? (
        <p class="text-error text-sm" role="alert">
          {props.copy.defaultSaveFailed}
        </p>
      ) : null}
      {clipboard.failed() === null ? null : (
        <p class="text-error text-sm" role="alert">
          {labels().copyFailed}
        </p>
      )}
      <p class="text-xs text-[var(--fuda-muted)]">{labels().snapshotHint}</p>
    </section>
  )
}
