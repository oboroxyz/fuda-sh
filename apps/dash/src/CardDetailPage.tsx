/** @jsxImportSource hono/jsx/dom */
import type { CardView } from '@fuda/sdk'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { cardUrl, displayUrl } from './card-designer.ts'
import { cardClaimText, cardValidityText } from './card-display.ts'
import type { DashCopy } from './copy.ts'
import { QrBlock } from './QrBlock.tsx'
import { cardEditPath } from './router.ts'
import type { DashRoute } from './router.ts'
import { useCopyText } from './use-copy-text.ts'

export interface CardDetailPageProps {
  card: CardView | null
  copy: DashCopy
  publicUrl: string
  onNavigate: (route: DashRoute) => void
}
const MS_PER_SECOND = 1000

export const CardDetailPage = ({ card, copy, publicUrl, onNavigate }: CardDetailPageProps): JSX.Element => {
  const clipboard = useCopyText()
  const { management: labels, published } = copy
  const link = (event: MouseEvent, route: DashRoute): void => {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return
    }
    event.preventDefault()
    onNavigate(route)
  }
  const url = card === null ? null : cardUrl(publicUrl, card.slug)
  // Native sharing is optional; the public URL remains copyable in every browser.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- browser feature detection for the Web Share API.
  const canShare = typeof globalThis.navigator?.share === 'function'
  const share = (): void => {
    if (url === null) {
      return
    }
    const run = async (): Promise<void> => {
      try {
        await navigator.share({ url })
      } catch {
        // Dismissing the share sheet needs no alert.
      }
    }
    void run()
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
        {labels.back}
      </a>
      <header class="dash-page-header dash-no-print">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h1 class="dash-page-title">{card?.title ?? copy.stamps.cardNotFound}</h1>
          {card === null ? null : (
            <a
              class="link link-hover inline-flex min-h-11 items-center text-sm"
              href={cardEditPath(card)}
              onClick={(event) => {
                link(event, cardEditPath(card))
              }}
            >
              {labels.edit}
            </a>
          )}
        </div>
        {card === null ? null : (
          <p class="text-[var(--fuda-muted)]">
            {card.category === 'membership' ? labels.membership : labels.ticket}
          </p>
        )}
      </header>
      {card === null || url === null ? null : (
        <>
          <div class="card dash-no-print flex flex-col gap-4 p-5">
            {card.description === '' ? null : <p class="whitespace-pre-line">{card.description}</p>}
            <dl class="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt class="mb-1 text-[var(--fuda-muted)]">{copy.designer.claimLabel}</dt>
                <dd>{cardClaimText(published, card, Math.floor(Date.now() / MS_PER_SECOND))}</dd>
              </div>
              <div>
                <dt class="mb-1 text-[var(--fuda-muted)]">{copy.designer.validityLabel}</dt>
                <dd>{cardValidityText(published, card)}</dd>
              </div>
            </dl>
          </div>
          <div class="dash-print-target card p-6 print:border-0">
            <h2 class="hidden text-2xl font-bold print:block">{card.title}</h2>
            <QrBlock label={published.qrLabel} qr={url} />
            <a
              class="link link-hover text-center font-mono text-sm"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {displayUrl(url)}
            </a>
          </div>
          <div class="dash-actions dash-no-print">
            <button
              class="btn"
              type="button"
              onClick={() => {
                clipboard.copy(url)
              }}
            >
              {clipboard.copied === url ? published.copied : published.copy}
            </button>
            <button
              class="btn"
              type="button"
              onClick={() => {
                globalThis.print()
              }}
            >
              {published.print}
            </button>
            {canShare ? (
              <button class="btn" type="button" onClick={share}>
                {published.share}
              </button>
            ) : null}
          </div>
          {clipboard.failed === null ? null : (
            <p role="alert" class="dash-no-print text-error text-sm">
              {labels.copyFailed}
            </p>
          )}
        </>
      )}
    </section>
  )
}
