import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import {
  brandTextColor,
  cardBySlug,
  formatMemberNumber,
  normalizeUid,
  passPlatform,
  qrSvg,
  soleCard,
  toQr,
} from '@fuda/sdk'
import type {
  CardView,
  Hex,
  PassBackup,
  PassUrls,
  PublicCard,
  PublicVenue,
  SelfServeIssueResponse,
} from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { CardsThree, FingerprintSimple } from '@fuda/ui'
import { WalletButton } from '@fuda/ui/wallet-view'
import { Fragment } from 'preact'
import type { JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'

import { cardFailureOf, claimSourceFrom, fetchVenue, googleSaveUrl, issueCard } from '../api.ts'
import type { CardFailure } from '../api.ts'
import { defaultHumanBadgeIo, requestHumanBadge } from '../badges.ts'
import type { BadgeState, HumanBadgeIo } from '../badges.ts'
import { cardKey, readCard, readCardMemory, rememberCard } from '../card-memory.ts'
import type { CardMemoryEntry } from '../card-memory.ts'
import { applePassAvailable } from '../member-pass-list.ts'
import { addPasskey, claimWithPasskey } from '../member/auth.ts'
import type { PasskeyClaim } from '../member/auth.ts'
import type { SensitiveClaim } from '../member/sensitive.ts'
import { fetchPassBackup, passBackupHref } from '../pass-backup.ts'
import { memberPassUrls } from '../pass-links.ts'
import { rememberPass } from '../pass-memory.ts'
import type { PassMemoryStorage } from '../pass-memory.ts'
import { signInHref } from '../route.ts'
import { claimToken } from '../turnstile.ts'
import type { ClaimToken } from '../turnstile.ts'
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
      // A Sensitive pass that was issued but could not be listed yet.
      unsaved?: boolean
    }
  | { kind: 'error'; card: PublicCard | null; failure: CardFailure }
  // The passkey gave no PRF result, so a Sensitive card stops here and says what to do.
  | { kind: 'no_prf'; card: PublicCard }

export interface CardScreenIo {
  appleAvailable: (url: string) => Promise<boolean>
  claimWithPasskey: (
    handle: string,
    slug: string,
    source: string | null,
    turnstileToken: string | null,
  ) => Promise<PasskeyClaim>
  claimToken: (container: HTMLElement | null) => Promise<ClaimToken>
  fetchBackup: (uid: Hex) => Promise<Result<PassBackup>>
  fetchVenue: (handle: string) => Promise<Result<PublicVenue>>
  googleSaveUrl: (url: string) => Promise<string | null>
  issueCard: (
    handle: string,
    slug: string,
    source: string | null,
    turnstileToken: string | null,
  ) => Promise<Result<SelfServeIssueResponse>>
}

export interface CardScreenViewProps {
  // Receives the element the bot check renders in, which stays mounted across states.
  botCheckRef?: (element: HTMLDivElement | null) => void
  locale?: Locale
  onAddPasskey?: () => void
  onIssue: () => void
  onReload: () => void
  onVerifyHuman: () => void
  signedIn?: boolean
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

const isSensitiveCard = (card: PublicCard): boolean => card.card.identity === 'sensitive'

// Bound to a key, so a QR or a Wallet pass would admit nobody.
const isKeyBoundCard = (card: PublicCard): boolean =>
  card.card.identity === 'passkey' || isSensitiveCard(card)

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
        {(venue.cards ?? []).map((card) => (
          <Fragment key={card.slug}>{chooserRow(venue, card, heldSlugs.includes(card.slug), copy)}</Fragment>
        ))}
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

const backupLink = (issued: IssuedCard, hint: string, copy: VenueCopy): JSX.Element => (
  <>
    <a
      class="link mx-auto text-sm"
      download={`fuda-pass-${issued.uid.slice(2, 10)}.json`}
      href={passBackupHref(issued.uid)}
    >
      {copy.saveBackup}
    </a>
    <p class="mx-auto max-w-64 text-center text-xs leading-5 text-[var(--fuda-muted)]">{hint}</p>
  </>
)

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
    {backupLink(issued, copy.saveBackupHint, copy)}
  </div>
)

// docs/specs/pass-types-and-flows.md#keeping-a-pass-without-a-provider. This pass answers
// only to its passkey, so a QR or a Wallet pass would admit nobody, and neither is offered.
const passkeyEntry = (card: PublicCard, issued: IssuedCard, copy: VenueCopy): JSX.Element => (
  <div class="venue-pass-actions">
    <a class="btn btn-primary" href={`/signed?uid=${issued.uid}`}>
      <FingerprintSimple />
      {copy.enterWithPasskey}
    </a>
    <p class="mx-auto max-w-64 text-center text-xs leading-5 text-[var(--fuda-muted)]">
      {copy.passkeyEntryNote}
    </p>
    <p class="mx-auto max-w-64 text-center text-xs leading-5 text-[var(--fuda-muted)]">
      {copy.keptOnAccount(nounOf(card, copy))}
    </p>
    {backupLink(issued, copy.passkeyBackupHint, copy)}
  </div>
)

// docs/specs/pass-types-and-flows.md#sensitive-use. No backup and nothing kept on this device
// in the clear: the member's list is the only place this pass is written down.
const sensitiveEntry = (issued: IssuedCard, unsaved: boolean, copy: VenueCopy): JSX.Element => (
  <div class="venue-pass-actions">
    <a class="btn btn-primary" href={`/signed?uid=${issued.uid}`}>
      <FingerprintSimple />
      {copy.enterWithPasskey}
    </a>
    <p class="mx-auto max-w-64 text-center text-xs leading-5 text-[var(--fuda-muted)]">
      {copy.sensitiveEntryNote}
    </p>
    {unsaved ? (
      <p role="status" class="alert alert-warning text-sm">
        {copy.sensitiveUnsaved}
      </p>
    ) : (
      <p class="mx-auto max-w-64 text-center text-xs leading-5 text-[var(--fuda-muted)]">
        {copy.sensitiveFindLater}
      </p>
    )}
  </div>
)

// docs/specs/pass-types-and-flows.md#sensitive-use: the web cannot choose the passkey
// provider, so this says which ones work and lets the member save a new passkey there.
const noPrfScreen = (
  card: PublicCard,
  onAddPasskey: () => void,
  onIssue: () => void,
  copy: VenueCopy,
): JSX.Element => {
  const guide = copy.sensitiveNoPrf
  return (
    <>
      {landingCard(card)}
      <section class="flex flex-col gap-3" data-testid="no-prf-guidance">
        <h2 class="text-lg font-semibold">{guide.title}</h2>
        <p class="text-sm leading-6">{guide.body}</p>
        <ul class="list-disc pl-5 text-sm leading-6">
          <li>{guide.apple}</li>
          <li>{guide.google}</li>
          <li>{guide.other}</li>
        </ul>
        <p class="text-sm leading-6 text-[var(--fuda-muted)]">{guide.keepsSigningIn}</p>
        <button
          class="btn btn-primary w-full"
          type="button"
          onClick={() => {
            onAddPasskey()
          }}
        >
          <FingerprintSimple />
          {guide.addPasskey}
        </button>
        <button
          class="btn w-full"
          type="button"
          onClick={() => {
            onIssue()
          }}
        >
          {guide.tryAgain}
        </button>
      </section>
    </>
  )
}

const claimNote = (card: PublicCard, copy: VenueCopy): string =>
  isSensitiveCard(card) ? copy.claimSensitiveNote : copy.claimPasskeyNote

// A pass bound to a passkey needs an account to claim, so someone signed out is sent to
// sign in first, and comes back to this same address, with any source label on it.
const passkeyClaim = (
  card: PublicCard,
  signedIn: boolean,
  busy: boolean,
  onIssue: () => void,
  copy: VenueCopy,
): JSX.Element => (
  <div class="venue-primary">
    {signedIn ? (
      <button
        class="btn btn-primary w-full"
        type="button"
        disabled={busy}
        onClick={() => {
          onIssue()
        }}
      >
        {busy ? (
          <span class="loading loading-spinner loading-xs" aria-hidden="true" />
        ) : (
          <FingerprintSimple />
        )}
        {busy ? copy.gettingCard : copy.getWithPasskey(nounOf(card, copy))}
      </button>
    ) : (
      <a
        class="btn btn-primary w-full"
        href={signInHref(`${globalThis.location.pathname}${globalThis.location.search}`)}
      >
        <FingerprintSimple />
        {copy.signInToGet(nounOf(card, copy))}
      </a>
    )}
    <p role="status" aria-live="polite" class="text-center text-xs opacity-70">
      {busy ? copy.keepOpen : claimNote(card, copy)}
    </p>
    {signedIn || busy ? null : <p class="text-center text-xs opacity-70">{copy.needsAccount}</p>}
    {isSensitiveCard(card) && !busy ? (
      <a class="link text-center text-xs" href="/rights">
        {copy.sensitiveAlreadyHeld}
      </a>
    ) : null}
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
          dangerouslySetInnerHTML={{ __html: qrSvg(badge.connectorUri, { modulePx: 144 }) }}
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
      dangerouslySetInnerHTML={{ __html: qrSvg(issued.qr, { modulePx: 120 }) }}
    />
    <p class="text-center text-xs leading-5 text-[var(--fuda-muted)]">{copy.showQr}</p>
  </div>
)

const readyActions = (
  state: Extract<CardScreenState, { kind: 'ready' }>,
  copy: VenueCopy,
  locale: Locale,
): JSX.Element => {
  if (isSensitiveCard(state.card)) {
    return sensitiveEntry(state.issued, state.unsaved === true, copy)
  }
  return isKeyBoundCard(state.card)
    ? passkeyEntry(state.card, state.issued, copy)
    : passActions(state.card, state.issued, state.googleHref, state.appleHref, copy, locale)
}

const readyScreen = (
  state: Extract<CardScreenState, { kind: 'ready' }>,
  copy: VenueCopy,
  locale: Locale,
  onVerifyHuman: () => void,
): JSX.Element => (
  <>
    <section class="venue-held-card">
      {memberCard(state.card, state.issued, copy, locale)}
      {isKeyBoundCard(state.card) ? null : qrBlock(state.card, state.issued, copy)}
    </section>
    {readyActions(state, copy, locale)}
    {humanBadgeControl(state.badge, onVerifyHuman, copy)}
  </>
)

const landingScreen = (
  state: Extract<CardScreenState, { kind: 'issuing' | 'landing' }>,
  copy: VenueCopy,
  onIssue: () => void,
  signedIn: boolean,
): JSX.Element => {
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
  if (isKeyBoundCard(state.card)) {
    return (
      <>
        {landingCard(state.card)}
        {cardDescription(state.card)}
        {passkeyClaim(state.card, signedIn, busy, onIssue, copy)}
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

// One screen per state. Nothing here takes typing, so rebuilding the screen on
// a state change loses no input.
const screenOf = (
  state: CardScreenState,
  locale: Locale,
  onIssue: () => void,
  onReload: () => void,
  onVerifyHuman: () => void,
  signedIn: boolean,
  onAddPasskey: () => void,
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
  if (state.kind === 'no_prf') {
    return noPrfScreen(state.card, onAddPasskey, onIssue, copy)
  }
  if (state.kind === 'ready') {
    return readyScreen(state, copy, locale, onVerifyHuman)
  }
  return landingScreen(state, copy, onIssue, signedIn)
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
      props.signedIn ?? false,
      () => {
        props.onAddPasskey?.()
      },
    )}
    <div class="venue-bot-check" ref={props.botCheckRef} />
  </VenueLayout>
)

const defaultIo: CardScreenIo = {
  appleAvailable: applePassAvailable,
  claimToken,
  claimWithPasskey,
  fetchBackup: fetchPassBackup,
  fetchVenue,
  googleSaveUrl,
  issueCard,
}

// What a Sensitive card needs beyond the rest. Lazy: only these cards need the key code,
// and this screen opens for every card.
export interface CardSensitiveIo {
  addPasskey: () => Promise<{ ok: true; credentialId: string } | { ok: false }>
  claim: (
    card: {
      cardTitle: string
      slug: string
      source: string | null
      venue: string
      turnstileToken?: string | null
    },
    only?: string,
  ) => Promise<SensitiveClaim>
}

const defaultSensitive: CardSensitiveIo = {
  addPasskey: async () => {
    const added = await addPasskey()
    return added.ok ? { credentialId: added.credentialId, ok: true } : { ok: false }
  },
  claim: async (card, only) => {
    const loaded = await import('../member/sensitive.ts').catch(() => null)
    if (loaded === null) {
      return { failure: 'network', ok: false }
    }
    return await loaded.claimSensitive(loaded.defaultSensitiveIo, card, only)
  },
}

const issuedFrom = (entry: CardMemoryEntry): IssuedCard => ({
  ...entry,
  passUrls: memberPassUrls(entry.uid),
  qr: toQr(entry.uid),
})

// A link from a saved pass names its uid (docs/specs/pass-types-and-flows.md#keeping-a-pass-without-a-provider),
// so a new device opens that pass instead of offering a second one. The uid leaves the
// address at once, to stay out of the history. One that does not belong to this card is ignored.
const passFromLink = async (
  io: CardScreenIo,
  handle: string,
  slug: string,
  storage?: PassMemoryStorage,
): Promise<IssuedCard | null> => {
  const url = new URL(globalThis.location.href)
  const raw = url.searchParams.get('uid')
  if (raw === null) {
    return null
  }
  url.searchParams.delete('uid')
  globalThis.history.replaceState(globalThis.history.state, '', url)
  const uid = normalizeUid(raw)
  if (uid === null) {
    return null
  }
  const backup = await io.fetchBackup(uid)
  if (!backup.ok || backup.body.handle !== handle || backup.body.slug !== slug) {
    return null
  }
  const { holder, memberNumber } = backup.body
  const issuedAt = Date.now()
  rememberCard(handle, slug, { holder, memberNumber, uid }, storage, issuedAt)
  rememberPass({ holder, uid }, storage, issuedAt)
  return issuedFrom({ holder, issuedAt, memberNumber, uid })
}

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
  // Whether a member session cookie came with this page. The api has the last word.
  signedIn?: boolean
  sensitive?: CardSensitiveIo
  storage?: PassMemoryStorage
}

const publicClaim = async (
  io: CardScreenIo,
  handle: string,
  slug: string,
  source: string | null,
  turnstileToken: string | null,
): Promise<PasskeyClaim> => {
  const result = await io.issueCard(handle, slug, source, turnstileToken)
  return result.ok ? { body: result.body, ok: true } : { failure: cardFailureOf(result), ok: false }
}

export const CardScreen = (props: CardScreenProps): JSX.Element => {
  const io = props.io ?? defaultIo
  const humanBadgeIo = props.humanBadgeIo ?? defaultHumanBadgeIo
  const sensitive = props.sensitive ?? defaultSensitive
  const [state, setState] = useState<CardScreenState>({ kind: 'loading' })
  const [generation, setGeneration] = useState(0)
  const [sessionEnded, setSessionEnded] = useState(false)
  const issuing = useRef(false)
  const lifecycle = useRef(0)
  const botCheck = useRef<HTMLDivElement | null>(null)
  const preloaded = useRef(props.initial)

  // Only probe the device's platform. The browser pass remains available until
  // its wallet is confirmed, and remains the fallback if it is not configured.
  const showReady = async (
    card: PublicCard,
    issued: IssuedCard,
    isCurrent: () => boolean,
    unsaved = false,
  ): Promise<void> => {
    setState({
      appleHref: null,
      badge: humanBadgeStateOf(card),
      card,
      googleHref: null,
      issued,
      kind: 'ready',
      unsaved,
    })
    if (isKeyBoundCard(card)) {
      return
    }
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

  useLayoutEffect(() => {
    const { handle, slug } = props
    lifecycle.current += 1
    issuing.current = false
    let current = true
    const { storage } = props
    setState({ kind: 'loading' })
    void (async () => {
      const result = preloaded.current ?? (await io.fetchVenue(handle))
      preloaded.current = undefined
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
      const brought = await passFromLink(io, handle, picked.card.slug, storage)
      if (!current) {
        return
      }
      if (brought !== null) {
        await showReady(picked, brought, () => current)
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
  }, [generation, props.handle, props.slug])

  const claimFor = async (
    card: PublicCard,
    source: string | null,
    turnstileToken: string | null,
    only?: string,
  ): Promise<PasskeyClaim | SensitiveClaim> => {
    if (isSensitiveCard(card)) {
      return await sensitive.claim(
        { cardTitle: card.card.title, slug: card.card.slug, source, turnstileToken, venue: props.handle },
        only,
      )
    }
    return card.card.identity === 'passkey'
      ? await io.claimWithPasskey(props.handle, card.card.slug, source, turnstileToken)
      : await publicClaim(io, props.handle, card.card.slug, source, turnstileToken)
  }

  const issue = async (card: PublicCard, only?: string): Promise<void> => {
    if (issuing.current) {
      return
    }
    issuing.current = true
    const ticket = lifecycle.current
    const { handle, storage } = props
    setState({ card, kind: 'issuing' })
    const source = claimSourceFrom(window.location.search)
    const check = await io.claimToken(botCheck.current)
    if (!check.ok) {
      if (ticket === lifecycle.current) {
        issuing.current = false
        setState({ card, failure: 'bot_check_failed', kind: 'error' })
      }
      return
    }
    const result = await claimFor(card, source, check.token, only)
    const current = ticket === lifecycle.current
    if (current) {
      issuing.current = false
    }
    if (!result.ok) {
      if (!current) {
        return
      }
      if (result.failure === 'signed_out') {
        setSessionEnded(true)
        setState({ card, kind: 'landing' })
        return
      }
      if (result.failure === 'no_prf') {
        setState({ card, kind: 'no_prf' })
        return
      }
      setState({ card, failure: result.failure, kind: 'error' })
      return
    }
    const { holder, memberNumber, uid } = result.body
    const issuedAt = Date.now()
    // A Sensitive pass stays out of both lists, in the clear here and synced to the account
    // from there: the vault is its only record.
    if (!isSensitiveCard(card)) {
      rememberCard(handle, card.card.slug, { holder, memberNumber, uid }, storage, issuedAt)
      rememberPass({ holder, uid }, storage, issuedAt)
    }
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
      () => ticket === lifecycle.current,
      'saved' in result && !result.saved,
    )
  }

  const onIssue = (): void => {
    const current = state
    if (current.kind === 'landing') {
      void issue(current.card)
      return
    }
    // A failed issue keeps the card it was reading, so the button retries it.
    if (current.kind === 'no_prf') {
      void issue(current.card)
      return
    }
    if (current.kind === 'error' && current.card !== null) {
      void issue(current.card)
    }
  }

  // The new passkey is the one to ask next, or the chooser would offer the old one again.
  const onAddPasskey = (): void => {
    const current = state
    if (current.kind !== 'no_prf') {
      return
    }
    const { card } = current
    void (async () => {
      const added = await sensitive.addPasskey()
      if (added.ok) {
        await issue(card, added.credentialId)
      }
    })()
  }

  const onVerifyHuman = (): void => {
    const current = state
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
      botCheckRef={(element) => {
        botCheck.current = element
      }}
      locale={props.locale}
      onAddPasskey={onAddPasskey}
      onIssue={onIssue}
      onReload={() => {
        setGeneration((value) => value + 1)
      }}
      onVerifyHuman={onVerifyHuman}
      signedIn={props.signedIn === true && !sessionEnded}
      state={state}
    />
  )
}
