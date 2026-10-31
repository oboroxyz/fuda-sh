import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { brandTextColor, qrSvg } from '@fuda/sdk'
import type { PublicVenue } from '@fuda/sdk'
import { createSignal, For } from 'solid-js'
import type { JSX } from 'solid-js'

import { VENUE_COPY } from './copy.ts'
import type { VenueCopy } from './copy.ts'
import { cardClaimHref, selectEntry } from './entry.ts'

const HOME_COPY = {
  en: {
    choose: 'Choose a card',
    get: 'Get it on this device',
    print: 'Print this display',
    scan: 'Scan to get your card',
    tip: 'Open your phone camera and point it here.',
    title: 'Card claim QR code',
  },
  ja: {
    choose: '表示するカード',
    get: 'この端末で受け取る',
    print: 'この画面を印刷',
    scan: 'スキャンしてカードを受け取る',
    tip: 'スマートフォンのカメラをかざしてください。',
    title: 'カード受け取り用QRコード',
  },
}

const initialSlug = (venue: PublicVenue, requested: string | null): string | null => {
  if (requested !== null && venue.cards.some(({ slug }) => slug === requested)) {
    return requested
  }
  if (venue.defaultCardSlug !== null && venue.defaultCardSlug !== undefined) {
    return venue.defaultCardSlug
  }
  const choice = selectEntry(venue)
  return choice.kind === 'card' ? choice.slug : (venue.cards[0]?.slug ?? null)
}

const missingCardText = (venue: PublicVenue, copy: VenueCopy): string =>
  venue.cards.length === 0 ? copy.noCards(venue.name) : copy.defaultUnavailable

const selectedState = (selected: boolean): 'false' | 'true' => (selected ? 'true' : 'false')

const CardTabs = (props: {
  cards: PublicVenue['cards']
  selected: string | null
  label: string
  onSelect: (slug: string) => void
}): JSX.Element => {
  const onTabKey = (event: KeyboardEvent, index: number): void => {
    const { cards } = props
    let next = index
    switch (event.key) {
      case 'ArrowRight': {
        next = (index + 1) % cards.length
        break
      }
      case 'ArrowLeft': {
        next = (index + cards.length - 1) % cards.length
        break
      }
      case 'Home': {
        next = 0
        break
      }
      case 'End': {
        next = cards.length - 1
        break
      }
      default: {
        return
      }
    }
    const target = cards[next]
    if (target === undefined) {
      return
    }
    event.preventDefault()
    props.onSelect(target.slug)
    document.querySelector<HTMLButtonElement>(`#store-tab-${target.slug}`)?.focus()
  }
  // Until an alternative is chosen, this is a button group, not an unnamed tab
  // panel claiming to have an active tab.
  const tabbed = (): boolean => props.selected !== null
  return (
    <div role={tabbed() ? 'tablist' : 'group'} aria-label={props.label} class="tabs tabs-box store-home-tabs">
      <For each={props.cards}>
        {(item, index) => (
          <button
            type="button"
            id={`store-tab-${item.slug}`}
            role={tabbed() ? 'tab' : 'button'}
            aria-controls={tabbed() ? 'store-home-card' : undefined}
            aria-selected={tabbed() ? selectedState(props.selected === item.slug) : undefined}
            tabIndex={!tabbed() || props.selected === item.slug ? 0 : -1}
            class="tab"
            onKeyDown={(event) => {
              onTabKey(event, index())
            }}
            onClick={() => {
              props.onSelect(item.slug)
            }}
          >
            {item.title}
          </button>
        )}
      </For>
    </div>
  )
}

// The QR and claim link for a card that is handing out, or the reason it is not.
const claimPanel = (
  card: PublicVenue['cards'][number] | undefined,
  href: string | null,
  copy: (typeof HOME_COPY)['en'],
  unavailable: () => string,
): JSX.Element =>
  card?.claimable === true && href !== null ? (
    <>
      <div
        class="store-home-qr"
        role="img"
        aria-label={`${copy.title}: ${card.title}`}
        // Generated locally from the card URL, never from remote SVG markup.
        innerHTML={qrSvg(href, { modulePx: 12 })}
      />
      <div class="flex flex-col gap-2">
        <p class="text-base font-semibold sm:text-xl">{copy.scan}</p>
        <p class="text-xs leading-relaxed opacity-85 sm:text-sm">{copy.tip}</p>
      </div>
      <a
        data-claim-link
        href={href}
        class="store-home-receive inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        {copy.get}
        <span aria-hidden="true" class="ml-2">
          ↗
        </span>
      </a>
    </>
  ) : (
    <p class="max-w-sm text-sm leading-relaxed" role="status">
      {unavailable()}
    </p>
  )

// Display-only: this component never issues a Card or chooses a Wallet platform.
export const StoreHome = (props: {
  venue: PublicVenue
  origin: string
  locale?: Locale
  requested?: string | null
}): JSX.Element => {
  const [selected, setSelected] = createSignal(initialSlug(props.venue, props.requested ?? null))
  const card = (): PublicVenue['cards'][number] | undefined =>
    props.venue.cards.find(({ slug }) => slug === selected())
  const copy = (): (typeof HOME_COPY)['en'] => pick(HOME_COPY, props.locale ?? DEFAULT_LOCALE)
  const venueCopy = (): VenueCopy => pick(VENUE_COPY, props.locale ?? DEFAULT_LOCALE)
  const href = (): string | null => {
    const current = card()
    return current === undefined
      ? null
      : new URL(cardClaimHref(props.venue.handle, current.slug), props.origin).href
  }
  const showTabs = (): boolean =>
    props.venue.cards.length > 1 || (props.venue.cards.length > 0 && card() === undefined)
  return (
    <main
      class="store-home"
      style={{ 'background-color': props.venue.brandColor, color: brandTextColor(props.venue.brandColor) }}
    >
      <div class="store-home-content">
        <header class="flex flex-col items-center gap-5">
          {props.venue.logoUrl === null ? null : (
            <img
              alt=""
              class="size-20 rounded-3xl object-contain sm:size-24"
              src={props.venue.logoUrl}
              onError={(event) => {
                event.currentTarget.hidden = true
              }}
            />
          )}
          <div class="flex flex-col gap-3">
            <h1 class="text-3xl leading-tight font-semibold tracking-tight sm:text-5xl">
              {props.venue.name}
            </h1>
            {props.venue.tagline === '' ? null : (
              <p class="text-sm leading-relaxed opacity-85 sm:text-base">{props.venue.tagline}</p>
            )}
          </div>
        </header>
        {showTabs() ? (
          <CardTabs
            cards={props.venue.cards}
            label={copy().choose}
            selected={card()?.slug ?? null}
            onSelect={(slug) => {
              setSelected(slug)
            }}
          />
        ) : null}
        <section
          id="store-home-card"
          role={showTabs() && card() !== undefined ? 'tabpanel' : undefined}
          aria-labelledby={showTabs() && card() !== undefined ? `store-tab-${card()?.slug ?? ''}` : undefined}
          class="flex w-full flex-col items-center gap-5"
          aria-live="polite"
        >
          {card() === undefined ? null : <h2 class="text-lg font-medium sm:text-xl">{card()?.title}</h2>}
          {claimPanel(card(), href(), copy(), () =>
            card() === undefined ? missingCardText(props.venue, venueCopy()) : venueCopy().notHandingOut,
          )}
        </section>
        <footer class="store-home-footer flex w-full items-center justify-between gap-4 text-xs">
          <span class="font-display text-xl tracking-tight">fuda.</span>
          <button
            type="button"
            class="min-h-11 cursor-pointer underline underline-offset-4"
            onClick={() => {
              window.print()
            }}
          >
            {copy().print}
          </button>
        </footer>
      </div>
    </main>
  )
}
