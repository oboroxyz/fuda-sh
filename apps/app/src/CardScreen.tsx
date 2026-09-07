/** @jsxImportSource hono/jsx/dom */
import { formatMemberNumber, passUrls, qrSvg, toQr } from '@fuda/sdk'
import type { PassUrls, PublicCard, SelfServeIssueResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { useCallback, useEffect, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { cardFailureOf, fetchCard, googleSaveUrl, issueCard } from './api.ts'
import type { CardFailure } from './api.ts'
import { readCard, rememberCard } from './card-memory.ts'
import type { CardMemoryEntry } from './card-memory.ts'
import { API_BASE_URL } from './config.ts'
import { rememberPass } from './pass-memory.ts'
import type { PassMemoryStorage } from './pass-memory.ts'

// A card this device holds: the remembered record plus what the pass links
// and QR are derived from. A fresh issue and a remembered card render alike.
export interface IssuedCard extends CardMemoryEntry {
  passUrls: PassUrls
  qr: string
}

export type CardScreenState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'landing'; card: PublicCard }
  | { kind: 'issuing'; card: PublicCard }
  | { kind: 'ready'; card: PublicCard; issued: IssuedCard; googleHref: string | null }
  | { kind: 'error'; card: PublicCard | null; failure: CardFailure }

export interface CardScreenIo {
  fetchCard: (handle: string) => Promise<Result<PublicCard>>
  googleSaveUrl: (url: string) => Promise<string | null>
  issueCard: (handle: string) => Promise<Result<SelfServeIssueResponse>>
}

export interface CardScreenViewProps {
  onIssue: () => void
  onReload: () => void
  state: CardScreenState
}

const ISSUE_DATE = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' })

export const issueDateOf = (issuedAt: number): string => ISSUE_DATE.format(new Date(issuedAt))

const FAILURE_MESSAGE = {
  chain_error: 'This venue cannot issue cards right now. Please try again later.',
  network: 'Could not reach fuda. Check your connection and try again.',
  no_signer: 'This venue cannot issue cards right now. Please try again later.',
  not_found: 'This card is no longer available.',
  rate_limited: 'Too many cards were requested from this device. Please try again later.',
} satisfies Record<CardFailure, string>

const nounOf = (card: PublicCard): string => (card.card.category === 'ticket' ? 'ticket' : 'membership card')

const roleOf = (card: PublicCard): string => (card.card.category === 'ticket' ? 'TICKET' : 'MEMBER')

const perksOf = (card: PublicCard): string[] =>
  [card.card.perk, card.card.reward].filter((text) => text !== '')

const brandCard = (card: PublicCard, body: JSX.Element): JSX.Element => (
  <div
    class="flex flex-col gap-4 rounded-2xl p-6 text-white shadow-lg"
    style={{ background: card.brandColor }}
  >
    <div class="text-xs font-semibold tracking-widest uppercase opacity-80">{card.name}</div>
    {body}
  </div>
)

const landingCard = (card: PublicCard): JSX.Element =>
  brandCard(
    card,
    <>
      <h1 class="text-2xl font-bold">{card.card.title}</h1>
      {card.tagline === '' ? null : <p class="text-sm opacity-90">{card.tagline}</p>}
    </>,
  )

const memberCard = (card: PublicCard, issued: IssuedCard): JSX.Element =>
  brandCard(
    card,
    <>
      <div class="text-lg font-bold">{card.card.title}</div>
      <div class="flex flex-col gap-1">
        <div class="text-xs tracking-widest uppercase opacity-80">{roleOf(card)}</div>
        <div class="font-mono text-xl">{formatMemberNumber(issued.memberNumber)}</div>
        <div class="text-xs opacity-80">Issued {issueDateOf(issued.issuedAt)}</div>
      </div>
    </>,
  )

const perkList = (card: PublicCard): JSX.Element | null => {
  const perks = perksOf(card)
  if (perks.length === 0) {
    return null
  }
  return (
    <ul class="flex flex-col gap-1 text-sm">
      {perks.map((perk): JSX.Element => (
        <li class="flex gap-2" key={perk}>
          <span aria-hidden="true">✓</span>
          <span>{perk}</span>
        </li>
      ))}
    </ul>
  )
}

const passActions = (card: PublicCard, issued: IssuedCard, googleHref: string | null): JSX.Element => (
  <div class="flex flex-col gap-2">
    <a class="btn btn-neutral" href={issued.passUrls.apple}>
      Add to Apple Wallet
    </a>
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
  <div class="flex justify-center">
    <div
      role="img"
      aria-label={`Your ${nounOf(card)} QR code for ${card.name}`}
      class="rounded-box bg-white p-2"
      // The markup is built locally by qrSvg from the right's uid — no remote or
      // venue-entered content reaches it.
      dangerouslySetInnerHTML={{ __html: qrSvg(issued.qr, { modulePx: 120 }) }}
    />
  </div>
)

const shell = (children: JSX.Element): JSX.Element => (
  <main class="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">{children}</main>
)

export const CardScreenView = ({ onIssue, onReload, state }: CardScreenViewProps): JSX.Element => {
  if (state.kind === 'loading') {
    return shell(<p class="text-sm opacity-70">Loading card…</p>)
  }
  if (state.kind === 'not_found') {
    return shell(
      <>
        <h1 class="text-xl font-bold">No card here</h1>
        <p class="text-sm opacity-70">There is no venue at this address. Check the link you were given.</p>
      </>,
    )
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
        {passActions(state.card, state.issued, state.googleHref)}
      </>,
    )
  }
  const busy = state.kind === 'issuing'
  return shell(
    <>
      {landingCard(state.card)}
      {perkList(state.card)}
      <button class="btn btn-primary" type="button" disabled={busy} onClick={onIssue}>
        {busy ? 'Getting your card…' : `Get your free ${nounOf(state.card)}`}
      </button>
      <p role="status" aria-live="polite" class="text-center text-xs opacity-70">
        {busy ? 'Getting your card…' : 'No sign-up · No app install'}
      </p>
    </>,
  )
}

const defaultIo: CardScreenIo = { fetchCard, googleSaveUrl, issueCard }

const issuedFrom = (entry: CardMemoryEntry): IssuedCard => ({
  ...entry,
  passUrls: passUrls(API_BASE_URL, entry.uid),
  qr: toQr(entry.uid),
})

export interface CardScreenProps {
  handle: string
  io?: CardScreenIo
  storage?: PassMemoryStorage
}

export const CardScreen = ({ handle, io = defaultIo, storage }: CardScreenProps): JSX.Element => {
  const [state, setState] = useState<CardScreenState>({ kind: 'loading' })
  const [generation, setGeneration] = useState(0)

  // The Google button is progressive: it appears only once the api confirms a
  // save link, so a venue without Google credentials never shows a dead button.
  const showReady = useCallback(
    async (card: PublicCard, issued: IssuedCard, isCurrent: () => boolean): Promise<void> => {
      setState({ card, googleHref: null, issued, kind: 'ready' })
      const googleHref = await io.googleSaveUrl(issued.passUrls.google)
      if (googleHref !== null && isCurrent()) {
        setState((previous) =>
          previous.kind === 'ready' && previous.issued.uid === issued.uid
            ? { ...previous, googleHref }
            : previous,
        )
      }
    },
    [io],
  )

  useEffect(() => {
    let current = true
    setState({ kind: 'loading' })
    void (async () => {
      const result = await io.fetchCard(handle)
      if (!current) {
        return
      }
      if (!result.ok) {
        const failure = cardFailureOf(result)
        setState(failure === 'not_found' ? { kind: 'not_found' } : { card: null, failure, kind: 'error' })
        return
      }
      const remembered = readCard(handle, storage)
      if (remembered === null) {
        setState({ card: result.body, kind: 'landing' })
        return
      }
      await showReady(result.body, issuedFrom(remembered), () => current)
    })()
    return () => {
      current = false
    }
  }, [generation, handle, io, showReady, storage])

  const issue = async (card: PublicCard): Promise<void> => {
    setState({ card, kind: 'issuing' })
    const result = await io.issueCard(handle)
    if (!result.ok) {
      setState({ card, failure: cardFailureOf(result), kind: 'error' })
      return
    }
    const { holder, memberNumber, uid } = result.body
    const issuedAt = Date.now()
    rememberCard(handle, { holder, memberNumber, uid }, storage, issuedAt)
    rememberPass({ holder, uid }, storage, issuedAt)
    await showReady(
      card,
      { holder, issuedAt, memberNumber, passUrls: result.body.passUrls, qr: result.body.qr, uid },
      () => true,
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

  return <CardScreenView onIssue={onIssue} onReload={onReload} state={state} />
}
