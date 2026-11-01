import type { CardView } from '@fuda/sdk'
import { Show } from 'solid-js'
import type { Accessor, JSX } from 'solid-js'

import { cardUrl, displayUrl } from './card-designer.ts'
import { cardClaimText, cardValidityText } from './card-display.ts'
import type { DashCopy } from './copy.ts'
import { QrBlock } from './QrBlock.tsx'
import { cardEditPath } from './router.ts'
import type { DashRoute } from './router.ts'
import { createCopyText } from './use-copy-text.ts'

export interface CardDetailPageProps {
  card: CardView | null
  copy: DashCopy
  publicUrl: string
  onNavigate: (route: DashRoute) => void
}
const MS_PER_SECOND = 1000

const share = (url: string): void => {
  const run = async (): Promise<void> => {
    try {
      await navigator.share({ url })
    } catch {
      // Dismissing the share sheet needs no alert.
    }
  }
  void run()
}

export const CardDetailPage = (props: CardDetailPageProps): JSX.Element => {
  const clipboard = createCopyText()
  const labels = (): DashCopy['management'] => props.copy.management
  const published = (): DashCopy['published'] => props.copy.published
  const link = (event: MouseEvent, route: DashRoute): void => {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return
    }
    event.preventDefault()
    props.onNavigate(route)
  }
  // Native sharing is optional; the public URL remains copyable in every browser.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- browser feature detection for the Web Share API.
  const canShare = typeof globalThis.navigator?.share === 'function'
  const details = (card: Accessor<CardView>): JSX.Element => {
    const url = (): string => cardUrl(props.publicUrl, card().slug)
    return (
      <>
        <div class="card dash-no-print flex flex-col gap-4 p-5">
          {card().description === '' ? null : <p class="whitespace-pre-line">{card().description}</p>}
          <dl class="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt class="mb-1 text-[var(--fuda-muted)]">{props.copy.designer.claimLabel}</dt>
              <dd>{cardClaimText(published(), card(), Math.floor(Date.now() / MS_PER_SECOND))}</dd>
            </div>
            <div>
              <dt class="mb-1 text-[var(--fuda-muted)]">{props.copy.designer.validityLabel}</dt>
              <dd>{cardValidityText(published(), card())}</dd>
            </div>
          </dl>
        </div>
        <div class="dash-print-target card p-6 print:border-0">
          <h2 class="hidden text-2xl font-bold print:block">{card().title}</h2>
          <QrBlock label={published().qrLabel} qr={url()} />
          <a
            class="link link-hover text-center font-mono text-sm"
            href={url()}
            target="_blank"
            rel="noopener noreferrer"
          >
            {displayUrl(url())}
          </a>
        </div>
        <div class="dash-actions dash-no-print">
          <button
            class="btn"
            type="button"
            onClick={() => {
              clipboard.copy(url())
            }}
          >
            {clipboard.copied() === url() ? published().copied : published().copy}
          </button>
          <button
            class="btn"
            type="button"
            onClick={() => {
              globalThis.print()
            }}
          >
            {published().print}
          </button>
          {canShare ? (
            <button
              class="btn"
              type="button"
              onClick={() => {
                share(url())
              }}
            >
              {published().share}
            </button>
          ) : null}
        </div>
        {clipboard.failed() === null ? null : (
          <p role="alert" class="dash-no-print text-error text-sm">
            {labels().copyFailed}
          </p>
        )}
      </>
    )
  }
  return (
    <section class="dash-page flex max-w-3xl flex-col gap-6">
      <a
        class="link link-hover dash-no-print self-start text-sm"
        href="/cards"
        onClick={(event) => {
          link(event, '/cards')
        }}
      >
        {labels().back}
      </a>
      <header class="dash-page-header dash-no-print">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h1 class="dash-page-title">{props.card?.title ?? props.copy.stamps.cardNotFound}</h1>
          <Show when={props.card}>
            {(card) => (
              <a
                class="link link-hover inline-flex min-h-11 items-center text-sm"
                href={cardEditPath(card())}
                onClick={(event) => {
                  link(event, cardEditPath(card()))
                }}
              >
                {labels().edit}
              </a>
            )}
          </Show>
        </div>
        <Show when={props.card}>
          {(card) => (
            <p class="text-[var(--fuda-muted)]">
              {card().category === 'membership' ? labels().membership : labels().ticket}
            </p>
          )}
        </Show>
      </header>
      <Show when={props.card}>{(card) => details(card)}</Show>
    </section>
  )
}
