import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import {
  brandTextColor,
  cardBySlug,
  formatMemberNumber,
  passPlatform,
  qrSvg,
  soleCard,
  toQr,
} from '@fuda/sdk'
import type { CardView, PassUrls, PublicCard, PublicVenue, SelfServeIssueResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { CardsThree, WalletButton } from '@fuda/ui'
import { createEffect, createSignal, For, on, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import { cardFailureOf, claimSourceFrom, fetchVenue, googleSaveUrl, issueCard } from '../api.ts'
import type { CardFailure } from '../api.ts'
import { defaultHumanBadgeIo, requestHumanBadge } from '../badges.ts'
import type { BadgeState, HumanBadgeIo } from '../badges.ts'
import { cardKey, readCard, readCardMemory, rememberCard } from '../card-memory.ts'
import type { CardMemoryEntry } from '../card-memory.ts'
import { applePassAvailable } from '../member-pass-list.ts'
import { memberPassUrls } from '../pass-links.ts'
import { rememberPass } from '../pass-memory.ts'
import type { PassMemoryStorage } from '../pass-memory.ts'
import { VENUE_COPY } from './copy.ts'
import type { VenueCopy } from './copy.ts'
import { cardClaimHref } from './entry.ts'
import { VenueLayout } from './VenueLayout.tsx'

// A card this device holds: the remembered record plus what the pass links
// and QR are derived from. A fresh issue and a remembered card render alike.
export interface IssuedCard extends CardMemoryEntry {
  passUrls: PassUrls
  qr: string
}

// A venue publishing more than one card cannot open any of them by itself, so
// `/@<handle>` lists them and the member picks. `heldSlugs` marks the cards
// this device already holds so a row offers the card back instead of a second
// claim.
export type CardScreenState =
  | { kind: 'loading' }
  | { kind: 'not_found'; venue: PublicVenue | null }
  | { kind: 'choose'; venue: PublicVenue; heldSlugs: readonly string[]; defaultUnavailable?: boolean }
  | { kind: 'landing'; card: PublicCard }
  | { kind: 'issuing'; card: PublicCard }
  | {
      kind: 'ready'
      card: PublicCard
      issued: IssuedCard
      googleHref: string | null
      appleHref: string | null
      badge: BadgeState
    }
  | { kind: 'error'; card: PublicCard | null; failure: CardFailure }

export interface CardScreenIo {
  appleAvailable: (url: string) => Promise<boolean>
  fetchVenue: (handle: string) => Promise<Result<PublicVenue>>
  googleSaveUrl: (url: string) => Promise<string | null>
  issueCard: (handle: string, slug: string, source: string | null) => Promise<Result<SelfServeIssueResponse>>
}

export interface CardScreenViewProps {
  locale?: Locale
  onIssue: () => void
  onReload: () => void
  onVerifyHuman: () => void
  state: CardScreenState
}

const ISSUE_DATE = {
  en: new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }),
  ja: new Intl.DateTimeFormat('ja', { dateStyle: 'medium', timeZone: 'UTC' }),
}

export const issueDateOf = (issuedAt: number, locale: Locale = DEFAULT_LOCALE): string =>
  ISSUE_DATE[locale].format(new Date(issuedAt))

// The venue's own address, so a member who followed a card link can go back to
// everything else the venue publishes.
const venueHref = (handle: string): string => `/@${handle}?cards=all`

const cardHref = cardClaimHref

const nounOf = (card: PublicCard, copy: VenueCopy): string => copy.category[card.card.category].noun

interface VenueBrand {
  brandColor: string
  logoUrl: string | null
  name: string
}

// The api builds the mark's URL and versions it, so a replaced logo is a
// different URL; a client that assembled one from the handle would keep
// showing the old mark out of cache.
const brandCard = (venue: VenueBrand, body: JSX.Element): JSX.Element => (
  <div
    class="venue-brand"
    style={{ 'background-color': venue.brandColor, color: brandTextColor(venue.brandColor) }}
  >
    <div class="flex items-center gap-3">
      {venue.logoUrl === null ? null : (
        <img
          alt=""
          class="size-10 flex-none rounded-xl bg-white/10 object-cover"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.hidden = true
          }}
          src={venue.logoUrl}
        />
      )}
      <div class="min-w-0 text-sm font-semibold">{venue.name}</div>
    </div>
    {body}
  </div>
)

const landingCard = (card: PublicCard): JSX.Element =>
  brandCard(
    card,
    <>
      <div class="flex flex-col gap-2">
        <h1 class="text-[1.75rem] leading-tight font-semibold tracking-tight">{card.card.title}</h1>
        {card.tagline === '' ? null : <p class="text-sm leading-relaxed">{card.tagline}</p>}
      </div>
    </>,
  )

const memberCard = (card: PublicCard, issued: IssuedCard, copy: VenueCopy, locale: Locale): JSX.Element =>
  brandCard(
    card,
    <>
      <h1 class="text-2xl leading-tight font-semibold tracking-tight">{card.card.title}</h1>
      <div class="flex flex-col gap-2">
        <div class="text-[0.625rem] font-semibold tracking-[0.16em] uppercase">
          {copy.category[card.card.category].role}
        </div>
        <div class="font-mono text-lg tracking-wide">{formatMemberNumber(issued.memberNumber)}</div>
        <div class="text-[0.6875rem]">{copy.issued(issueDateOf(issued.issuedAt, locale))}</div>
      </div>
    </>,
  )

const cardDescription = (card: PublicCard): JSX.Element | null =>
  card.card.description === '' ? null : (
    <p class="venue-description text-sm leading-7 wrap-anywhere whitespace-pre-wrap">
      {card.card.description}
    </p>
  )

// A card the member already holds is worth opening; one outside its claim
// window is not, so it reads as closed rather than inviting a dead-end tap.
const rowInvitation = (card: CardView, held: boolean, copy: VenueCopy): string => {
  if (held) {
    return copy.heldCard
  }
  return card.claimable ? copy.getCard(copy.category[card.category].noun) : copy.notHandingOut
}

const chooserRow = (venue: PublicVenue, card: CardView, held: boolean, copy: VenueCopy): JSX.Element => (
  <li>
    <a
      class={
        card.claimable || held ? 'venue-choice hover:border-base-content/40' : 'venue-choice border-dashed'
      }
      href={cardHref(venue.handle, card.slug)}
    >
      <div class="flex items-center justify-between gap-3">
        <span class="min-w-0 font-bold [overflow-wrap:anywhere]">{card.title}</span>
        <span class="badge badge-sm badge-ghost shrink-0">{copy.category[card.category].label}</span>
      </div>
      {card.description === '' ? null : (
        <span class="line-clamp-3 text-sm wrap-anywhere whitespace-pre-wrap opacity-70">
          {card.description}
        </span>
      )}
      <span class="mt-2 flex items-center justify-between gap-3 text-xs font-semibold text-[var(--fuda-muted)]">
        {rowInvitation(card, held, copy)}
        {card.claimable || held ? (
          <span aria-hidden="true" class="text-lg">
            ↗
          </span>
        ) : null}
      </span>
    </a>
  </li>
)

const chooser = (venue: PublicVenue, heldSlugs: readonly string[], copy: VenueCopy): JSX.Element => (
  <>
    {brandCard(
      venue,
      <>
        <h1 class="text-2xl font-bold">{copy.pickCard}</h1>
        {venue.tagline === '' ? null : <p class="text-sm opacity-90">{venue.tagline}</p>}
      </>,
    )}
    {venue.cards.length === 0 ? (
      <p class="venue-empty">{copy.noCards(venue.name)}</p>
    ) : (
      <ul class="flex flex-col gap-3">
        <For each={venue.cards}>{(card) => chooserRow(venue, card, heldSlugs.includes(card.slug), copy)}</For>
      </ul>
    )}
  </>
)

const notFound = (venue: PublicVenue | null, copy: VenueCopy): JSX.Element => {
  if (venue === null || venue.cards.length === 0) {
    return (
      <>
        <h1 class="text-xl font-bold">{copy.noCard}</h1>
        <p class="text-sm opacity-70">{copy.notFound}</p>
      </>
    )
  }
  return (
    <>
      <h1 class="text-xl font-bold">{copy.noCard}</h1>
      <p class="text-sm opacity-70">{copy.noCardAtAddress(venue.name)}</p>
      <a class="btn btn-primary" href={venueHref(venue.handle)}>
        {copy.seeAllCards(venue.name)}
      </a>
    </>
  )
}

const passAction = (
  issued: IssuedCard,
  googleHref: string | null,
  appleHref: string | null,
  copy: VenueCopy,
  locale: Locale,
): JSX.Element => {
  const platform = passPlatform(globalThis.navigator?.userAgent ?? '')
  if (platform === 'apple' && appleHref !== null) {
    return <WalletButton platform="apple" href={appleHref} label={copy.appleWallet} locale={locale} />
  }
  if (platform === 'google' && googleHref !== null) {
    return (
      <WalletButton platform="google" href={googleHref} label={copy.googleWallet} locale={locale} newTab />
    )
  }
  return (
    <a class="btn btn-neutral" href={issued.passUrls.web} target="_blank" rel="noreferrer">
      <CardsThree />
      {copy.browserPass}
    </a>
  )
}

const passActions = (
  card: PublicCard,
  issued: IssuedCard,
  googleHref: string | null,
  appleHref: string | null,
  copy: VenueCopy,
  locale: Locale,
): JSX.Element => (
  <div class="venue-pass-actions">
    {passAction(issued, googleHref, appleHref, copy, locale)}
    <p class="mx-auto max-w-64 text-center text-xs leading-5 text-[var(--fuda-muted)]">
      {copy.savedOnDevice(nounOf(card, copy))}
    </p>
  </div>
)

// The control starts hidden unless this card offers the `human` kind: its
// issuer turned the integration on and the deployment has a verifier for it
// (docs/specs/pass-types-and-flows.md#card-integrations). Otherwise the feature
// must look like it does not exist, rather than appear and earn a 501 or 404 on
// the first tap. The list rides on the venue payload this screen already
// fetched, so this costs no request.
export const humanBadgeStateOf = (card: PublicCard): BadgeState =>
  card.card.badges?.includes('human') === true ? { kind: 'idle' } : { kind: 'unavailable' }

// `unavailable` (the api has no verifier configured) hides the control
// entirely, so an unconfigured deployment looks like the feature does not
// exist rather than like it is broken.
const humanBadgeControl = (
  badge: BadgeState,
  onVerifyHuman: () => void,
  copy: VenueCopy,
): JSX.Element | null => {
  if (badge.kind === 'unavailable') {
    return null
  }
  if (badge.kind === 'done') {
    return (
      <div class="badge badge-neutral" role="status">
        {copy.verifiedHuman}
      </div>
    )
  }
  if (badge.kind === 'taken') {
    return (
      <p role="status" class="text-center text-xs opacity-70">
        {copy.alreadyVerifiedHuman}
      </p>
    )
  }
  // The hand-off, once there is a target for it. The link opens in its own tab
  // so this page stays alive: it is the page still waiting for the answer, and
  // navigating away from it loses a verification the member has completed. The
  // code carries the same target for a member reading this on a desktop.
  if (badge.kind === 'waiting' && badge.connectorUri !== null) {
    return (
      <div class="flex flex-col items-center gap-3">
        <a class="btn btn-outline btn-sm" href={badge.connectorUri} target="_blank" rel="noreferrer noopener">
          {copy.continueVerification}
        </a>
        <div
          role="img"
          aria-label={copy.verificationQrLabel}
          class="w-36 max-w-full bg-white p-2"
          // qrSvg builds the markup locally from the URI; the URI only decides
          // which modules are dark, and never reaches the document as markup.
          innerHTML={qrSvg(badge.connectorUri, { modulePx: 144 })}
        />
        <p class="text-center text-xs leading-5 text-[var(--fuda-muted)]">{copy.keepOpen}</p>
      </div>
    )
  }
  const busy = badge.kind === 'opening' || badge.kind === 'waiting'
  return (
    <div class="flex flex-col items-center gap-2">
      <button
        class="btn btn-outline btn-sm"
        type="button"
        disabled={busy}
        onClick={() => {
          onVerifyHuman()
        }}
      >
        {busy ? <span class="loading loading-spinner loading-xs" aria-hidden="true" /> : null}
        {busy ? copy.verifyingHuman : copy.verifyHuman}
      </button>
      {badge.kind === 'error' && badge.detail !== undefined ? (
        <p role="status" class="text-center font-mono text-[0.6875rem] text-[var(--fuda-muted)]">
          {badge.detail}
        </p>
      ) : null}
    </div>
  )
}

const qrBlock = (card: PublicCard, issued: IssuedCard, copy: VenueCopy): JSX.Element => (
  <div class="venue-qr">
    <div
      role="img"
      aria-label={copy.qrLabel(card.name, nounOf(card, copy))}
      class="w-44 max-w-full bg-white p-3"
      // The markup is built locally by qrSvg from the right's uid — no remote or
      // venue-entered content reaches it.
      innerHTML={qrSvg(issued.qr, { modulePx: 120 })}
    />
    <p class="text-center text-xs leading-5 text-[var(--fuda-muted)]">{copy.showQr}</p>
  </div>
)

// One screen per state. Nothing here takes typing, so rebuilding the screen on
// a state change loses no input.
const screenOf = (
  state: CardScreenState,
  locale: Locale,
  onIssue: () => void,
  onReload: () => void,
  onVerifyHuman: () => void,
): JSX.Element => {
  const copy = pick(VENUE_COPY, locale)
  if (state.kind === 'loading') {
    return (
      <div class="venue-panel flex min-h-44 items-center justify-center gap-3" role="status">
        <span class="loading loading-spinner loading-sm" aria-hidden="true" />
        <p class="text-sm text-[var(--fuda-muted)]">{copy.loading}</p>
      </div>
    )
  }
  if (state.kind === 'not_found') {
    return notFound(state.venue, copy)
  }
  if (state.kind === 'choose') {
    return (
      <>
        {state.defaultUnavailable === true ? (
          <p class="alert alert-soft" role="status">
            {copy.defaultUnavailable}
          </p>
        ) : null}
        {chooser(state.venue, state.heldSlugs, copy)}
      </>
    )
  }
  if (state.kind === 'error') {
    return (
      <>
        {state.card === null ? null : landingCard(state.card)}
        <div role="alert" class="alert alert-error">
          {copy.failure[state.failure]}
        </div>
        <button
          class="btn"
          type="button"
          onClick={() => {
            if (state.card === null) {
              onReload()
            } else {
              onIssue()
            }
          }}
        >
          {copy.tryAgain}
        </button>
      </>
    )
  }
  if (state.kind === 'ready') {
    return (
      <>
        <section class="venue-held-card">
          {memberCard(state.card, state.issued, copy, locale)}
          {qrBlock(state.card, state.issued, copy)}
        </section>
        {passActions(state.card, state.issued, state.googleHref, state.appleHref, copy, locale)}
        {humanBadgeControl(state.badge, onVerifyHuman, copy)}
      </>
    )
  }
  const busy = state.kind === 'issuing'
  // A card outside its claim window would only earn a 409, so the screen says
  // so instead of offering a button that cannot work.
  if (!state.card.card.claimable) {
    return (
      <>
        {landingCard(state.card)}
        {cardDescription(state.card)}
        <p role="status" class="text-center text-sm opacity-70">
          {copy.closedCard(state.card.name, nounOf(state.card, copy))}
        </p>
        <a class="btn" href={venueHref(state.card.handle)}>
          {copy.seeAllCards(state.card.name)}
        </a>
      </>
    )
  }
  return (
    <>
      {landingCard(state.card)}
      {cardDescription(state.card)}
      <div class="venue-primary">
        <button
          class="btn btn-primary w-full"
          type="button"
          disabled={busy}
          onClick={() => {
            onIssue()
          }}
        >
          {busy ? <span class="loading loading-spinner loading-xs" aria-hidden="true" /> : <CardsThree />}
          {busy ? copy.gettingCard : copy.getFreeCard(nounOf(state.card, copy))}
        </button>
        <p role="status" aria-live="polite" class="text-center text-xs opacity-70">
          {busy ? copy.keepOpen : copy.noSignUp}
        </p>
      </div>
    </>
  )
}

export const CardScreenView = (props: CardScreenViewProps): JSX.Element => (
  <VenueLayout>
    {screenOf(
      props.state,
      props.locale ?? DEFAULT_LOCALE,
      () => {
        props.onIssue()
      },
      () => {
        props.onReload()
      },
      () => {
        props.onVerifyHuman()
      },
    )}
  </VenueLayout>
)

const defaultIo: CardScreenIo = {
  appleAvailable: applePassAvailable,
  fetchVenue,
  googleSaveUrl,
  issueCard,
}

const issuedFrom = (entry: CardMemoryEntry): IssuedCard => ({
  ...entry,
  passUrls: memberPassUrls(entry.uid),
  qr: toQr(entry.uid),
})

export const heldSlugsOf = (venue: PublicVenue, storage?: PassMemoryStorage): string[] => {
  const memory = readCardMemory(storage)
  return venue.cards
    .filter((card) => Object.hasOwn(memory, cardKey(venue.handle, card.slug)))
    .map((card) => card.slug)
}

export interface CardScreenProps {
  handle: string
  locale?: Locale
  slug: string | null
  io?: CardScreenIo
  humanBadgeIo?: HumanBadgeIo
  // The venue the Worker already read for this page; the first load uses it
  // instead of asking the api again.
  initial?: Result<PublicVenue>
  storage?: PassMemoryStorage
}

export const CardScreen = (props: CardScreenProps): JSX.Element => {
  const io = props.io ?? defaultIo
  const humanBadgeIo = props.humanBadgeIo ?? defaultHumanBadgeIo
  const [state, setState] = createSignal<CardScreenState>({ kind: 'loading' })
  const [generation, setGeneration] = createSignal(0)
  let issuing = false
  let lifecycle = 0
  let preloaded = props.initial

  // Only probe the device's platform. The browser pass remains available until
  // its wallet is confirmed, and remains the fallback if it is not configured.
  const showReady = async (card: PublicCard, issued: IssuedCard, isCurrent: () => boolean): Promise<void> => {
    setState({
      appleHref: null,
      badge: humanBadgeStateOf(card),
      card,
      googleHref: null,
      issued,
      kind: 'ready',
    })
    const platform = passPlatform(globalThis.navigator?.userAgent ?? '')
    const googleHref = platform === 'google' ? await io.googleSaveUrl(issued.passUrls.google) : null
    const appleReady = platform === 'apple' && (await io.appleAvailable(issued.passUrls.apple))
    const appleHref = appleReady ? issued.passUrls.apple : null
    if ((googleHref !== null || appleHref !== null) && isCurrent()) {
      setState((previous) =>
        previous.kind === 'ready' && previous.issued.uid === issued.uid
          ? { ...previous, appleHref, googleHref }
          : previous,
      )
    }
  }

  createEffect(
    on([generation, () => props.handle, () => props.slug], ([, handle, slug]) => {
      lifecycle += 1
      issuing = false
      let current = true
      const { storage } = props
      setState({ kind: 'loading' })
      void (async () => {
        const result = preloaded ?? (await io.fetchVenue(handle))
        preloaded = undefined
        if (!current) {
          return
        }
        if (!result.ok) {
          const failure = cardFailureOf(result)
          setState(
            failure === 'not_found'
              ? { kind: 'not_found', venue: null }
              : { card: null, failure, kind: 'error' },
          )
          return
        }
        const venue = result.body
        // A link that named a card opens that card; a bare venue address opens
        // its only card, or asks the member to pick when there are several.
        const picked = slug === null ? soleCard(venue) : cardBySlug(venue, slug)
        if (picked === null) {
          setState(
            slug === null
              ? { heldSlugs: heldSlugsOf(venue, storage), kind: 'choose', venue }
              : { kind: 'not_found', venue },
          )
          return
        }
        const remembered = readCard(handle, picked.card.slug, storage)
        if (remembered === null) {
          setState({ card: picked, kind: 'landing' })
          return
        }
        await showReady(picked, issuedFrom(remembered), () => current)
      })()
      onCleanup(() => {
        current = false
        lifecycle += 1
      })
    }),
  )

  const issue = async (card: PublicCard): Promise<void> => {
    if (issuing) {
      return
    }
    issuing = true
    const ticket = lifecycle
    const { handle, storage } = props
    setState({ card, kind: 'issuing' })
    const result = await io.issueCard(handle, card.card.slug, claimSourceFrom(window.location.search))
    const current = ticket === lifecycle
    if (current) {
      issuing = false
    }
    if (!result.ok) {
      if (!current) {
        return
      }
      setState({ card, failure: cardFailureOf(result), kind: 'error' })
      return
    }
    const { holder, memberNumber, uid } = result.body
    const issuedAt = Date.now()
    rememberCard(handle, card.card.slug, { holder, memberNumber, uid }, storage, issuedAt)
    rememberPass({ holder, uid }, storage, issuedAt)
    // A submitted issuance belongs to its original venue even after navigation.
    // Keep the public Pass, but never replace the next screen with this result.
    if (!current) {
      return
    }
    await showReady(
      card,
      // The api answers its own absolute URLs; the member's links go through
      // this Worker like every other call (src/pass-links.ts).
      { holder, issuedAt, memberNumber, passUrls: memberPassUrls(uid), qr: result.body.qr, uid },
      () => ticket === lifecycle,
    )
  }

  const onIssue = (): void => {
    const current = state()
    if (current.kind === 'landing') {
      void issue(current.card)
      return
    }
    // A failed issue keeps the card it was reading, so the button retries it.
    if (current.kind === 'error' && current.card !== null) {
      void issue(current.card)
    }
  }

  const onVerifyHuman = (): void => {
    const current = state()
    if (current.kind !== 'ready') {
      return
    }
    const { uid } = current.issued
    void requestHumanBadge(humanBadgeIo, uid, (badge) => {
      setState((previous) =>
        previous.kind === 'ready' && previous.issued.uid === uid ? { ...previous, badge } : previous,
      )
    })
  }

  return (
    <CardScreenView
      locale={props.locale}
      onIssue={onIssue}
      onReload={() => {
        setGeneration((value) => value + 1)
      }}
      onVerifyHuman={onVerifyHuman}
      state={state()}
    />
  )
}
