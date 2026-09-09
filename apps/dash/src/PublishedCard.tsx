/** @jsxImportSource hono/jsx/dom */
import type { CardView, IssuerView } from '@fuda/sdk'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { cardUrl, claimStateOf, displayUrl, formatInstant, validityStateOf } from './card-designer.ts'
import type { DashCopy } from './copy.ts'
import { QrBlock } from './QrBlock.tsx'

export interface PublishedCardViewProps {
  canAddCard: boolean
  cards: CardView[]
  // The venue's ENS section, or null while this deployment has no ENS parent.
  // Passed in already rendered so the claim's own state stays out of this view.
  // The card whose link was just copied, so only its button confirms.
  copiedSlug: string | null
  copy: DashCopy['published']
  issuer: IssuerView
  // The venue's own mark, refused by the api until there is one.
  onAddCard: () => void
  onVenue: () => void
  onCopy: (slug: string) => void
  onPrint: (slug: string) => void
  onShare: ((slug: string) => void) | null
  // Unix seconds, only to word a closed card as "not open yet" or "closed";
  // whether it is open at all is the api's `claimable`.
  now: number
  // Non-null while one card's poster is printing; the other posters step aside.
  printSlug: string | null
  publicUrl: string
}

const instantOrEmpty = (seconds: number | null): string => (seconds === null ? '' : formatInstant(seconds))

// One card's claim state and its validity, in plain words with the instants
// filled in.
const claimText = (copy: DashCopy['published'], card: CardView, now: number): string => {
  const state = claimStateOf(card, now)
  const key = state === 'closed' && card.claimUntil !== null ? 'closedSince' : state
  return copy.claimStates[key]
    .replace('{from}', instantOrEmpty(card.claimFrom))
    .replace('{until}', instantOrEmpty(card.claimUntil))
}

const validityText = (copy: DashCopy['published'], card: CardView): string =>
  copy.validityStates[validityStateOf(card)]
    .replace('{days}', String(card.validityDays))
    .replace('{from}', instantOrEmpty(card.validFrom))
    .replace('{until}', instantOrEmpty(card.validUntil))

const cardEntry = (props: PublishedCardViewProps, card: CardView): JSX.Element => {
  const { copiedSlug, copy, issuer, now, onCopy, onPrint, onShare, printSlug } = props
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

      <div class="dash-no-print flex flex-wrap items-center gap-2 text-sm">
        <span class={cn('badge', card.claimable ? 'badge-success' : 'badge-neutral')}>
          {claimText(copy, card, now)}
        </span>
        <span class="badge badge-ghost">{validityText(copy, card)}</span>
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

const publishedIntro = (copy: DashCopy['published'], count: number) => {
  if (count === 0) {
    return { description: copy.emptyDescription, heading: copy.emptyTitle }
  }
  if (count === 1) {
    return { description: copy.description, heading: copy.title }
  }
  return { description: copy.descriptionMany, heading: copy.titleMany }
}

export const PublishedCardView = (props: PublishedCardViewProps): JSX.Element => {
  const { cards, copy, onAddCard, onVenue, printSlug } = props
  const { description, heading } = publishedIntro(copy, cards.length)
  let actionLabel = copy.manageVenue
  if (props.canAddCard) {
    actionLabel = cards.length === 0 ? copy.createFirst : copy.addCard
  }
  return (
    <section
      class={cn('dash-published flex max-w-2xl flex-col gap-6', printSlug !== null && 'dash-print-one')}
    >
      <div class="dash-no-print flex flex-col gap-1">
        <h1 class="text-2xl font-bold">{heading}</h1>
        <p class="opacity-70">{description}</p>
      </div>

      {cards.map((card): JSX.Element => cardEntry(props, card))}

      <div class="dash-actions dash-no-print">
        <button class="btn" onClick={props.canAddCard ? onAddCard : onVenue} type="button">
          {actionLabel}
        </button>
      </div>

      <p class="dash-no-print text-sm opacity-70">{copy.hint}</p>
    </section>
  )
}

const COPIED_MS = 2000
const MS_PER_SECOND = 1000

export type PublishedCardProps = Omit<
  PublishedCardViewProps,
  'copiedSlug' | 'now' | 'onCopy' | 'onPrint' | 'onShare' | 'printSlug'
>

export const PublishedCard = (props: PublishedCardProps): JSX.Element => {
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
      now={Math.floor(Date.now() / MS_PER_SECOND)}
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
