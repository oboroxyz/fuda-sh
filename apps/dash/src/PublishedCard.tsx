/** @jsxImportSource hono/jsx/dom */
import type { CardView, IssuerView } from '@fuda/sdk'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { cardUrl, displayUrl } from './card-designer.ts'
import type { DashCopy } from './copy.ts'
import { QrBlock } from './QrBlock.tsx'

export interface PublishedCardViewProps {
  cards: CardView[]
  // The card whose link was just copied, so only its button confirms.
  copiedSlug: string | null
  copy: DashCopy['published']
  issuer: IssuerView
  onAddCard: () => void
  onCopy: (slug: string) => void
  onPrint: (slug: string) => void
  onShare: ((slug: string) => void) | null
  // Non-null while one card's poster is printing; the other posters step aside.
  printSlug: string | null
  publicUrl: string
}

const cardEntry = (props: PublishedCardViewProps, card: CardView): JSX.Element => {
  const { copiedSlug, copy, issuer, onCopy, onPrint, onShare, printSlug } = props
  const url = cardUrl(props.publicUrl, card.slug)
  const asideForPrint = printSlug !== null && printSlug !== card.slug
  return (
    <article class="dash-published-card" key={card.slug}>
      <div class="dash-card-preview dash-no-print" style={{ background: issuer.brandColor }}>
        <div class="dash-card-preview-top">
          <span>{issuer.name}</span>
          <span>{card.category === 'ticket' ? 'TICKET' : 'MEMBER'}</span>
        </div>
        <strong>{card.title}</strong>
      </div>

      <div class={cn('dash-print-target', asideForPrint && 'dash-no-print')}>
        <QrBlock label={copy.qrLabel} qr={url} />
        <code class="text-sm font-semibold">{displayUrl(url)}</code>
      </div>

      <div class="dash-actions dash-no-print">
        <button
          class="btn"
          onClick={() => {
            onPrint(card.slug)
          }}
          type="button"
        >
          {copy.print}
        </button>
        {onShare === null ? null : (
          <button
            class="btn"
            onClick={() => {
              onShare(card.slug)
            }}
            type="button"
          >
            {copy.share}
          </button>
        )}
        <button
          class="btn"
          onClick={() => {
            onCopy(card.slug)
          }}
          type="button"
        >
          {copiedSlug === card.slug ? copy.copied : copy.copy}
        </button>
      </div>
    </article>
  )
}

export const PublishedCardView = (props: PublishedCardViewProps): JSX.Element => {
  const { cards, copy, issuer, onAddCard, printSlug, publicUrl } = props
  const sole = cards.length === 1
  return (
    <section
      class={cn('dash-published flex max-w-2xl flex-col gap-6', printSlug !== null && 'dash-print-one')}
    >
      <div class="dash-no-print flex flex-col gap-1">
        <h1 class="text-2xl font-bold">{sole ? copy.title : copy.titleMany}</h1>
        <p class="opacity-70">{sole ? copy.description : copy.descriptionMany}</p>
        <p class="flex flex-wrap items-baseline gap-2 text-sm">
          <span class="font-semibold">{issuer.name}</span>
          <span class="opacity-70">{copy.venueLabel}</span>
          <code>{displayUrl(publicUrl)}</code>
        </p>
      </div>

      {cards.map((card): JSX.Element => cardEntry(props, card))}

      <div class="dash-actions dash-no-print">
        <button class="btn" onClick={onAddCard} type="button">
          {copy.addCard}
        </button>
      </div>

      <p class="dash-no-print text-sm opacity-70">{copy.hint}</p>
    </section>
  )
}

const COPIED_MS = 2000

export const PublishedCard = (
  props: Omit<PublishedCardViewProps, 'copiedSlug' | 'onCopy' | 'onPrint' | 'onShare' | 'printSlug'>,
): JSX.Element => {
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const [printSlug, setPrintSlug] = useState<string | null>(null)
  // One timer for the whole list: copying a second card must reset the first
  // card's countdown, not let it clear the second card's confirmation early.
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // `navigator.share` exists only on some browsers, so the action appears only
  // where it works; copy and print are always available.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- feature detection of a browser API, not a domain value
  const canShare = typeof globalThis.navigator?.share === 'function'

  // The narrowed poster has to be on screen before the dialog opens, so the
  // print runs one render after the choice, not in the click handler.
  useEffect(() => {
    if (printSlug === null) {
      return
    }
    globalThis.print()
    setPrintSlug(null)
  }, [printSlug])

  return (
    <PublishedCardView
      {...props}
      copiedSlug={copiedSlug}
      onCopy={(slug) => {
        const run = async (): Promise<void> => {
          try {
            await globalThis.navigator.clipboard.writeText(cardUrl(props.publicUrl, slug))
            setCopiedSlug(slug)
            if (copiedTimer.current !== null) {
              clearTimeout(copiedTimer.current)
            }
            copiedTimer.current = setTimeout(() => {
              copiedTimer.current = null
              setCopiedSlug(null)
            }, COPIED_MS)
          } catch {
            setCopiedSlug(null)
          }
        }
        void run()
      }}
      onPrint={setPrintSlug}
      onShare={
        canShare
          ? (slug) => {
              const run = async (): Promise<void> => {
                try {
                  await globalThis.navigator.share({ url: cardUrl(props.publicUrl, slug) })
                } catch {
                  // a dismissed share sheet is not an error worth reporting
                }
              }
              void run()
            }
          : null
      }
      printSlug={printSlug}
    />
  )
}
