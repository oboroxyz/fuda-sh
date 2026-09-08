/** @jsxImportSource hono/jsx/dom */
import type { CardView, IssuerView } from '@fuda/sdk'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { cardUrl, claimStateOf, displayUrl, formatInstant, validityStateOf } from './card-designer.ts'
import type { DashCopy } from './copy.ts'
import { browserLogoTools, EMPTY_LOGO, generateLogoSet, withLogoResult } from './logo.ts'
import type { LogoSet, LogoState } from './logo.ts'
import { LogoField } from './LogoField.tsx'
import { QrBlock } from './QrBlock.tsx'

export interface PublishedCardViewProps {
  cards: CardView[]
  // The venue's ENS section, or null while this deployment has no ENS parent.
  // Passed in already rendered so the claim's own state stays out of this view.
  ens: JSX.Element | null
  // The card whose link was just copied, so only its button confirms.
  copiedSlug: string | null
  copy: DashCopy['published']
  issuer: IssuerView
  // The venue's own mark, refused by the api until there is one.
  logo: LogoState
  logoBusy: boolean
  logoCopy: DashCopy['logo']
  logoFailed: boolean
  // null once the mark has proved to be missing, which is the venue's normal
  // unbranded state, not an error.
  logoSrc: string | null
  onAddCard: () => void
  onCopy: (slug: string) => void
  onLogoError: () => void
  onLogoPick: (file: File) => void
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

export const PublishedCardView = (props: PublishedCardViewProps): JSX.Element => {
  const { cards, copy, issuer, logoCopy, logoSrc, onAddCard, onLogoError, printSlug, publicUrl } = props
  const sole = cards.length === 1
  return (
    <section
      class={cn('dash-published flex max-w-2xl flex-col gap-6', printSlug !== null && 'dash-print-one')}
    >
      <div class="dash-no-print flex flex-col gap-1">
        <h1 class="text-2xl font-bold">{sole ? copy.title : copy.titleMany}</h1>
        <p class="opacity-70">{sole ? copy.description : copy.descriptionMany}</p>
        <p class="flex flex-wrap items-center gap-2 text-sm">
          {logoSrc === null ? null : (
            <img
              alt={logoCopy.previewAlt}
              class="border-base-300 rounded-box size-8 border object-cover"
              onError={onLogoError}
              src={logoSrc}
            />
          )}
          <span class="font-semibold">{issuer.name}</span>
          <span class="opacity-70">{copy.venueLabel}</span>
          <code>{displayUrl(publicUrl)}</code>
        </p>
      </div>

      {cards.map((card): JSX.Element => cardEntry(props, card))}

      <div class="dash-no-print">
        <LogoField
          busy={props.logoBusy}
          copy={logoCopy}
          id="change-logo"
          label={logoCopy.change}
          onClear={null}
          onPick={props.onLogoPick}
          state={props.logo}
        />
        {props.logoFailed ? (
          <p class="text-error mt-2 text-sm" role="alert">
            {logoCopy.updateFailed}
          </p>
        ) : null}
      </div>

      {props.ens === null ? null : <div class="dash-no-print">{props.ens}</div>}

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
const MS_PER_SECOND = 1000

export interface PublishedCardProps extends Omit<
  PublishedCardViewProps,
  | 'copiedSlug'
  | 'logo'
  | 'logoBusy'
  | 'logoFailed'
  | 'logoSrc'
  | 'now'
  | 'onCopy'
  | 'onLogoError'
  | 'onLogoPick'
  | 'onPrint'
  | 'onShare'
  | 'printSlug'
> {
  // Stages and commits the picked mark; false when it could not be applied.
  onCommitLogo: (variants: LogoSet) => Promise<boolean>
}

export const PublishedCard = ({ onCommitLogo, ...props }: PublishedCardProps): JSX.Element => {
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const [logo, setLogo] = useState<LogoState>(EMPTY_LOGO)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  // An <img> error is how a venue without a mark announces itself: the asset
  // route answers 404 and the name stands alone, as it does today.
  const [logoMissing, setLogoMissing] = useState(false)
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

  const onLogoPick = (file: File): void => {
    const run = async (): Promise<void> => {
      const result = await generateLogoSet(file, browserLogoTools)
      // The preview stands in while the upload runs; the live mark replaces it.
      const picked = withLogoResult(result, (blob) => URL.createObjectURL(blob))
      setLogo(picked)
      if (!result.ok) {
        return
      }
      setLogoFailed(false)
      setLogoBusy(true)
      const applied = await onCommitLogo(result.variants)
      setLogoBusy(false)
      setLogoFailed(!applied)
      if (!applied) {
        return
      }
      setLogoMissing(false)
      setLogo(EMPTY_LOGO)
      if (picked.pick !== null) {
        URL.revokeObjectURL(picked.pick.previewUrl)
      }
    }
    void run()
  }

  return (
    <PublishedCardView
      {...props}
      copiedSlug={copiedSlug}
      logo={logo}
      logoBusy={logoBusy}
      logoFailed={logoFailed}
      logoSrc={logoMissing ? null : props.issuer.logoUrl}
      onLogoError={() => {
        setLogoMissing(true)
      }}
      onLogoPick={onLogoPick}
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
