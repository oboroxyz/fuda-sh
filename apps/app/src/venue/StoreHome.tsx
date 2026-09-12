/** @jsxImportSource hono/jsx/dom */
import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { brandTextColor, qrSvg } from '@fuda/sdk'
import type { PublicVenue } from '@fuda/sdk'
import { useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

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

const CardTabs = ({
  cards,
  selected,
  label,
  onSelect,
}: {
  cards: PublicVenue['cards']
  selected: string | null
  label: string
  onSelect: (slug: string) => void
}): JSX.Element => {
  const onTabKey = (event: KeyboardEvent, index: number): void => {
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
    onSelect(target.slug)
    document.querySelector<HTMLButtonElement>(`#store-tab-${target.slug}`)?.focus()
  }
  return (
    <div
      role={selected === null ? 'group' : 'tablist'}
      aria-label={label}
      class="tabs tabs-box store-home-tabs"
    >
      {cards.map((item, index): JSX.Element => {
        // Until an alternative is chosen, this is a button group, not an
        // unnamed tab panel claiming to have an active tab.
        const semantics =
          selected === null
            ? { role: 'button', tabIndex: 0 }
            : {
                'aria-controls': 'store-home-card',
                'aria-selected': selected === item.slug ? 'true' : 'false',
                role: 'tab',
                tabIndex: selected === item.slug ? 0 : -1,
              }
        return (
          <button
            type="button"
            key={item.slug}
            id={`store-tab-${item.slug}`}
            {...semantics}
            class="tab"
            onKeyDown={(event: KeyboardEvent) => {
              onTabKey(event, index)
            }}
            onClick={() => {
              onSelect(item.slug)
            }}
          >
            {item.title}
          </button>
        )
      })}
    </div>
  )
}

// Display-only: this component never issues a Card or chooses a Wallet platform.
export const StoreHome = ({
  venue,
  origin,
  locale = DEFAULT_LOCALE,
  requested = null,
}: {
  venue: PublicVenue
  origin: string
  locale?: Locale
  requested?: string | null
}): JSX.Element => {
  const [selected, setSelected] = useState(() => initialSlug(venue, requested))
  const card = venue.cards.find(({ slug }) => slug === selected)
  const copy = pick(HOME_COPY, locale)
  const venueCopy = pick(VENUE_COPY, locale)
  const href = card === undefined ? null : new URL(cardClaimHref(venue.handle, card.slug), origin).href
  const showTabs = venue.cards.length > 1 || (venue.cards.length > 0 && card === undefined)
  return (
    <main
      class="store-home"
      style={{ backgroundColor: venue.brandColor, color: brandTextColor(venue.brandColor) }}
    >
      <div class="store-home-content">
        <header class="flex flex-col items-center gap-5">
          {venue.logoUrl === null ? null : (
            <img
              alt=""
              class="size-20 rounded-3xl object-contain sm:size-24"
              src={venue.logoUrl}
              onError={(event: Event & { currentTarget: HTMLImageElement }) => {
                event.currentTarget.hidden = true
              }}
            />
          )}
          <div class="flex flex-col gap-3">
            <h1 class="text-3xl leading-tight font-semibold tracking-tight sm:text-5xl">{venue.name}</h1>
            {venue.tagline === '' ? null : (
              <p class="text-sm leading-relaxed opacity-85 sm:text-base">{venue.tagline}</p>
            )}
          </div>
        </header>
        {showTabs ? (
          <CardTabs
            cards={venue.cards}
            label={copy.choose}
            selected={card?.slug ?? null}
            onSelect={setSelected}
          />
        ) : null}
        <section
          id="store-home-card"
          role={showTabs && card !== undefined ? 'tabpanel' : undefined}
          aria-labelledby={showTabs && card !== undefined ? `store-tab-${card.slug}` : undefined}
          class="flex w-full flex-col items-center gap-5"
          aria-live="polite"
        >
          {card === undefined ? null : <h2 class="text-lg font-medium sm:text-xl">{card.title}</h2>}
          {card?.claimable === true && href !== null ? (
            <>
              <div
                class="store-home-qr"
                role="img"
                aria-label={`${copy.title}: ${card.title}`}
                // Generated locally from the card URL, never from remote SVG markup.
                dangerouslySetInnerHTML={{ __html: qrSvg(href, { modulePx: 12 }) }}
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
              {card === undefined ? missingCardText(venue, venueCopy) : venueCopy.notHandingOut}
            </p>
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
            {copy.print}
          </button>
        </footer>
      </div>
    </main>
  )
}
