import { DEFAULT_LOCALE } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import type { PublicVenue } from '@fuda/sdk'
import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { cardFailureOf, fetchVenue as fetchPublicVenue } from '../api.ts'
import { CardScreenView, heldSlugsOf } from './CardScreen.tsx'
import type { CardScreenState } from './CardScreen.tsx'
import { cardClaimHref, selectEntry } from './entry.ts'
import { StoreHome } from './StoreHome.tsx'

type VenueLoad =
  | { kind: 'venue'; venue: PublicVenue }
  | Extract<CardScreenState, { kind: 'loading' | 'error' | 'not_found' }>
const replaceLocation = (href: string): void => {
  location.replace(href)
}
const noop = (): void => {
  /* Entry and display never issue a Card. */
}

export const VenueScreen = (props: {
  handle: string
  mode: 'entry' | 'home'
  locale?: Locale
  search?: string
  fetchVenue?: typeof fetchPublicVenue
  // The venue the Worker already read for this page; the first load uses it
  // instead of asking the api again.
  initial?: Awaited<ReturnType<typeof fetchPublicVenue>>
  replace?: (href: string) => void
}): JSX.Element => {
  const locale = (): Locale => props.locale ?? DEFAULT_LOCALE
  const search = (): string => props.search ?? location.search
  const [state, setState] = createSignal<VenueLoad>({ kind: 'loading' })
  const [generation, setGeneration] = createSignal(0)
  let preloaded = props.initial
  createEffect(
    on([() => props.handle, () => props.mode, search, generation], ([handle, mode, query]) => {
      let current = true
      const fetchVenue = props.fetchVenue ?? fetchPublicVenue
      const replace = props.replace ?? replaceLocation
      setState({ kind: 'loading' })
      const load = async (): Promise<void> => {
        const result = preloaded ?? (await fetchVenue(handle))
        preloaded = undefined
        if (!current) {
          return
        }
        if (!result.ok) {
          setState(
            result.status === 404
              ? { kind: 'not_found', venue: null }
              : { card: null, failure: cardFailureOf(result), kind: 'error' },
          )
          return
        }
        const choice = selectEntry(result.body)
        if (mode === 'entry' && new URLSearchParams(query).get('cards') !== 'all' && choice.kind === 'card') {
          replace(`${cardClaimHref(handle, choice.slug)}${query}`)
          return
        }
        setState({ kind: 'venue', venue: result.body })
      }
      void load()
      onCleanup(() => {
        current = false
      })
    }),
  )

  const homeVenue = (): PublicVenue | null => {
    const current = state()
    return current.kind === 'venue' && props.mode === 'home' ? current.venue : null
  }
  const view = (): CardScreenState => {
    const current = state()
    if (current.kind !== 'venue') {
      return current
    }
    const choice = selectEntry(current.venue)
    return {
      defaultUnavailable: choice.kind === 'choose' && choice.defaultUnavailable,
      heldSlugs: heldSlugsOf(current.venue),
      kind: 'choose',
      venue: current.venue,
    }
  }
  return (
    <Show
      when={homeVenue()}
      fallback={
        <CardScreenView
          locale={locale()}
          state={view()}
          onIssue={noop}
          onReload={() => {
            setGeneration((value) => value + 1)
          }}
          onVerifyHuman={noop}
        />
      }
    >
      {(venue) => (
        // One store display per venue: a different handle starts it fresh.
        <Show when={props.handle} keyed>
          <StoreHome
            venue={venue()}
            locale={locale()}
            origin={location.origin}
            requested={new URLSearchParams(search()).get('card')}
          />
        </Show>
      )}
    </Show>
  )
}
