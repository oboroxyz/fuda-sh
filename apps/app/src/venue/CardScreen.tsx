/** @jsxImportSource hono/jsx/dom */
import { brandTextColor, cardBySlug, formatMemberNumber, passUrls, qrSvg, soleCard, toQr } from '@fuda/sdk'
import type {
  CardCategory,
  CardView,
  PassUrls,
  PublicCard,
  PublicVenue,
  SelfServeIssueResponse,
} from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { useCallback, useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { cardFailureOf, fetchVenue, googleSaveUrl, issueCard } from '../api.ts'
import type { CardFailure } from '../api.ts'
import { cardKey, readCard, readCardMemory, rememberCard } from '../card-memory.ts'
import type { CardMemoryEntry } from '../card-memory.ts'
import { API_BASE_URL } from '../config.ts'
import { applePassAvailable } from '../member-pass-list.ts'
import { rememberPass } from '../pass-memory.ts'
import type { PassMemoryStorage } from '../pass-memory.ts'
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
  | { kind: 'choose'; venue: PublicVenue; heldSlugs: readonly string[] }
  | { kind: 'landing'; card: PublicCard }
  | { kind: 'issuing'; card: PublicCard }
  | {
      kind: 'ready'
      card: PublicCard
      issued: IssuedCard
      googleHref: string | null
      appleHref: string | null
    }
  | { kind: 'error'; card: PublicCard | null; failure: CardFailure }

export interface CardScreenIo {
  appleAvailable: (url: string) => Promise<boolean>
  fetchVenue: (handle: string) => Promise<Result<PublicVenue>>
  googleSaveUrl: (url: string) => Promise<string | null>
  issueCard: (handle: string, slug: string) => Promise<Result<SelfServeIssueResponse>>
}

export interface CardScreenViewProps {
  handle: string
  onIssue: () => void
  onReload: () => void
  state: CardScreenState
}

const ISSUE_DATE = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' })

export const issueDateOf = (issuedAt: number): string => ISSUE_DATE.format(new Date(issuedAt))

const FAILURE_MESSAGE = {
  // The card closed between loading the page and tapping the button.
  card_closed: 'This card is no longer being handed out.',
  chain_error: 'This venue cannot issue cards right now. Please try again later.',
  network: 'Could not reach fuda. Check your connection and try again.',
  no_signer: 'This venue cannot issue cards right now. Please try again later.',
  not_found: 'This card is no longer available.',
  rate_limited: 'Too many cards were requested from this device. Please try again later.',
} satisfies Record<CardFailure, string>

// One table per card type: the heading, the sentence noun, and the role the
// card face carries.
const CATEGORY = {
  membership: { label: 'Membership', noun: 'membership card', role: 'MEMBER' },
  ticket: { label: 'Ticket', noun: 'ticket', role: 'TICKET' },
} satisfies Record<CardCategory, { label: string; noun: string; role: string }>

// The venue's own address, so a member who followed a card link can go back to
// everything else the venue publishes.
export const venueHref = (handle: string): string => `/@${handle}`

export const cardHref = (handle: string, slug: string): string => `/@${handle}/${slug}`

const nounOf = (card: PublicCard): string => CATEGORY[card.card.category].noun

const roleOf = (card: PublicCard): string => CATEGORY[card.card.category].role

const perksOf = (card: PublicCard): string[] =>
  [card.card.perk, card.card.reward].filter((text) => text !== '')

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
    style={{ backgroundColor: venue.brandColor, color: brandTextColor(venue.brandColor) }}
  >
    <div class="flex items-center gap-3">
      {venue.logoUrl === null ? null : (
        <img
          alt=""
          class="size-10 flex-none rounded-xl bg-white/10 object-cover"
          loading="lazy"
          onError={(event: Event & { currentTarget: HTMLImageElement }) => {
            event.currentTarget.hidden = true
          }}
          src={venue.logoUrl}
        />
      )}
      <div class="text-xs font-semibold tracking-widest uppercase">{venue.name}</div>
    </div>
    {body}
  </div>
)

const landingCard = (card: PublicCard): JSX.Element =>
  brandCard(
    card,
    <>
      <h1 class="text-2xl font-bold">{card.card.title}</h1>
      {card.tagline === '' ? null : <p class="text-sm">{card.tagline}</p>}
    </>,
  )

const memberCard = (card: PublicCard, issued: IssuedCard): JSX.Element =>
  brandCard(
    card,
    <>
      <div class="text-lg font-bold">{card.card.title}</div>
      <div class="flex flex-col gap-1">
        <div class="text-xs tracking-widest uppercase">{roleOf(card)}</div>
        <div class="font-mono text-xl">{formatMemberNumber(issued.memberNumber)}</div>
        <div class="text-xs">Issued {issueDateOf(issued.issuedAt)}</div>
      </div>
    </>,
  )

const perkList = (card: PublicCard): JSX.Element | null => {
  const perks = perksOf(card)
  if (perks.length === 0) {
    return null
  }
  return (
    <section class="venue-benefits">
      <h2 class="text-xs font-semibold tracking-widest uppercase">With this card</h2>
      <ul class="mt-4 flex flex-col gap-3 text-sm">
        {perks.map((perk): JSX.Element => (
          <li class="flex gap-2" key={perk}>
            <span aria-hidden="true">✓</span>
            <span>{perk}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// A card the member already holds is worth opening; one outside its claim
// window is not, so it reads as closed rather than inviting a dead-end tap.
const rowInvitation = (card: CardView, held: boolean): string => {
  if (held) {
    return 'You have this card · Show it'
  }
  return card.claimable ? `Get this ${CATEGORY[card.category].noun}` : 'Not being handed out right now'
}

const chooserRow = (venue: PublicVenue, card: CardView, held: boolean): JSX.Element => (
  <li key={card.slug}>
    <a
      class={
        card.claimable || held
          ? 'rounded-box border-base-300 bg-base-100 hover:border-base-content/30 flex flex-col gap-1 border p-4 transition'
          : 'rounded-box border-base-300 bg-base-100 flex flex-col gap-1 border p-4 opacity-60'
      }
      href={cardHref(venue.handle, card.slug)}
    >
      <div class="flex items-center justify-between gap-3">
        <span class="min-w-0 font-bold [overflow-wrap:anywhere]">{card.title}</span>
        <span class="badge badge-sm badge-ghost shrink-0">{CATEGORY[card.category].label}</span>
      </div>
      {card.perk === '' ? null : <span class="text-sm opacity-70">{card.perk}</span>}
      <span class="text-xs font-semibold opacity-80">{rowInvitation(card, held)}</span>
    </a>
  </li>
)

const chooser = (venue: PublicVenue, heldSlugs: readonly string[]): JSX.Element => (
  <>
    {brandCard(
      venue,
      <>
        <h1 class="text-2xl font-bold">Pick a card</h1>
        {venue.tagline === '' ? null : <p class="text-sm opacity-90">{venue.tagline}</p>}
      </>,
    )}
    {venue.cards.length === 0 ? (
      <p class="venue-empty">{venue.name} has no cards to hand out right now.</p>
    ) : (
      <ul class="flex flex-col gap-3">
        {venue.cards.map((card): JSX.Element => chooserRow(venue, card, heldSlugs.includes(card.slug)))}
      </ul>
    )}
  </>
)

const notFound = (venue: PublicVenue | null): JSX.Element => {
  if (venue === null || venue.cards.length === 0) {
    return (
      <>
        <h1 class="text-xl font-bold">No card here</h1>
        <p class="text-sm opacity-70">There is no card at this address. Check the link you were given.</p>
      </>
    )
  }
  return (
    <>
      <h1 class="text-xl font-bold">No card here</h1>
      <p class="text-sm opacity-70">{venue.name} has no card at this address.</p>
      <a class="btn btn-primary" href={venueHref(venue.handle)}>
        See all cards from {venue.name}
      </a>
    </>
  )
}

const passActions = (
  card: PublicCard,
  issued: IssuedCard,
  googleHref: string | null,
  appleHref: string | null,
): JSX.Element => (
  <div class="flex flex-col gap-2">
    {appleHref === null ? null : (
      <a class="btn btn-neutral" href={appleHref}>
        Add to Apple Wallet
      </a>
    )}
    {googleHref === null ? null : (
      <a class="btn btn-neutral" href={googleHref} target="_blank" rel="noreferrer">
        Add to Google Wallet
      </a>
    )}
    <a class="btn btn-ghost" href={issued.passUrls.web} target="_blank" rel="noreferrer">
      Open pass in browser
    </a>
    <p class="text-center text-xs opacity-70">
      No name or contact details required. This {nounOf(card)} is saved on this device.
    </p>
  </div>
)

const qrBlock = (card: PublicCard, issued: IssuedCard): JSX.Element => (
  <div class="venue-qr flex justify-center">
    <div
      role="img"
      aria-label={`Your ${nounOf(card)} QR code for ${card.name}`}
      class="rounded-box w-64 max-w-full bg-white p-2"
      // The markup is built locally by qrSvg from the right's uid — no remote or
      // venue-entered content reaches it.
      dangerouslySetInnerHTML={{ __html: qrSvg(issued.qr, { modulePx: 120 }) }}
    />
  </div>
)

export const CardScreenView = ({ handle, onIssue, onReload, state }: CardScreenViewProps): JSX.Element => {
  const shell = (children: JSX.Element): JSX.Element => VenueLayout({ children, handle })
  if (state.kind === 'loading') {
    return shell(
      <div class="venue-panel flex min-h-44 items-center justify-center gap-3" role="status">
        <span class="loading loading-spinner loading-sm" aria-hidden="true" />
        <p class="text-sm text-[var(--fuda-muted)]">Loading card…</p>
      </div>,
    )
  }
  if (state.kind === 'not_found') {
    return shell(notFound(state.venue))
  }
  if (state.kind === 'choose') {
    return shell(chooser(state.venue, state.heldSlugs))
  }
  if (state.kind === 'error') {
    return shell(
      <>
        {state.card === null ? null : landingCard(state.card)}
        <div role="alert" class="alert alert-error">
          {FAILURE_MESSAGE[state.failure]}
        </div>
        <button class="btn" type="button" onClick={state.card === null ? onReload : onIssue}>
          Try again
        </button>
      </>,
    )
  }
  if (state.kind === 'ready') {
    return shell(
      <>
        <h1 class="text-xl font-bold">Your card is ready</h1>
        {memberCard(state.card, state.issued)}
        {qrBlock(state.card, state.issued)}
        {passActions(state.card, state.issued, state.googleHref, state.appleHref)}
      </>,
    )
  }
  const busy = state.kind === 'issuing'
  // A card outside its claim window would only earn a 409, so the screen says
  // so instead of offering a button that cannot work.
  if (!state.card.card.claimable) {
    return shell(
      <>
        {landingCard(state.card)}
        {perkList(state.card)}
        <p role="status" class="text-center text-sm opacity-70">
          {state.card.name} is not handing out this {nounOf(state.card)} right now.
        </p>
        <a class="btn" href={venueHref(state.card.handle)}>
          See all cards from {state.card.name}
        </a>
      </>,
    )
  }
  return shell(
    <>
      {landingCard(state.card)}
      {perkList(state.card)}
      <div class="venue-primary">
        <button class="btn btn-primary w-full" type="button" disabled={busy} onClick={onIssue}>
          {busy ? 'Getting your card…' : `Get your free ${nounOf(state.card)}`}
        </button>
        <p role="status" aria-live="polite" class="text-center text-xs opacity-70">
          {busy ? 'Please keep this page open.' : 'No sign-up · No app install'}
        </p>
      </div>
    </>,
  )
}

const defaultIo: CardScreenIo = {
  appleAvailable: applePassAvailable,
  fetchVenue,
  googleSaveUrl,
  issueCard,
}

const issuedFrom = (entry: CardMemoryEntry): IssuedCard => ({
  ...entry,
  passUrls: passUrls(API_BASE_URL, entry.uid),
  qr: toQr(entry.uid),
})

const heldSlugsOf = (venue: PublicVenue, storage?: PassMemoryStorage): string[] => {
  const memory = readCardMemory(storage)
  return venue.cards
    .filter((card) => Object.hasOwn(memory, cardKey(venue.handle, card.slug)))
    .map((card) => card.slug)
}

export interface CardScreenProps {
  handle: string
  slug: string | null
  io?: CardScreenIo
  storage?: PassMemoryStorage
}

export const CardScreen = ({ handle, slug, io = defaultIo, storage }: CardScreenProps): JSX.Element => {
  const [state, setState] = useState<CardScreenState>({ kind: 'loading' })
  const [generation, setGeneration] = useState(0)
  const issuing = useRef(false)
  const lifecycle = useRef(0)

  // Both wallet buttons are progressive: each appears only once the api confirms
  // that platform's pass, so a deployment without Apple or Google credentials
  // shows the browser pass alone rather than a button that opens an error.
  const showReady = useCallback(
    async (card: PublicCard, issued: IssuedCard, isCurrent: () => boolean): Promise<void> => {
      setState({ appleHref: null, card, googleHref: null, issued, kind: 'ready' })
      const [googleHref, appleReady] = await Promise.all([
        io.googleSaveUrl(issued.passUrls.google),
        io.appleAvailable(issued.passUrls.apple),
      ])
      const appleHref = appleReady ? issued.passUrls.apple : null
      if ((googleHref !== null || appleHref !== null) && isCurrent()) {
        setState((previous) =>
          previous.kind === 'ready' && previous.issued.uid === issued.uid
            ? { ...previous, appleHref, googleHref }
            : previous,
        )
      }
    },
    [io],
  )

  useEffect(() => {
    lifecycle.current += 1
    issuing.current = false
    let current = true
    setState({ kind: 'loading' })
    void (async () => {
      const result = await io.fetchVenue(handle)
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
    return () => {
      current = false
      lifecycle.current += 1
    }
  }, [generation, handle, io, showReady, slug, storage])

  const issue = async (card: PublicCard): Promise<void> => {
    if (issuing.current) {
      return
    }
    issuing.current = true
    const ticket = lifecycle.current
    setState({ card, kind: 'issuing' })
    const result = await io.issueCard(handle, card.card.slug)
    const current = ticket === lifecycle.current
    if (current) {
      issuing.current = false
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
      { holder, issuedAt, memberNumber, passUrls: result.body.passUrls, qr: result.body.qr, uid },
      () => ticket === lifecycle.current,
    )
  }

  const onIssue = (): void => {
    if (state.kind === 'landing') {
      void issue(state.card)
      return
    }
    // A failed issue keeps the card it was reading, so the button retries it.
    if (state.kind === 'error' && state.card !== null) {
      void issue(state.card)
    }
  }

  const onReload = (): void => {
    setGeneration((value) => value + 1)
  }

  return <CardScreenView handle={handle} onIssue={onIssue} onReload={onReload} state={state} />
}
