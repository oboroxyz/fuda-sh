/** @jsxImportSource hono/jsx/dom */
import { DEFAULT_LOCALE } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import type { PublicVenue } from '@fuda/sdk'
import { useEffect, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

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

export const VenueScreen = ({
  handle,
  mode,
  locale = DEFAULT_LOCALE,
  search = location.search,
  fetchVenue = fetchPublicVenue,
  replace = replaceLocation,
}: {
  handle: string
  mode: 'entry' | 'home'
  locale?: Locale
  search?: string
  fetchVenue?: typeof fetchPublicVenue
  replace?: (href: string) => void
}): JSX.Element => {
  const [state, setState] = useState<VenueLoad>({ kind: 'loading' })
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    let current = true
    setState({ kind: 'loading' })
    const load = async (): Promise<void> => {
      const result = await fetchVenue(handle)
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
      if (mode === 'entry' && new URLSearchParams(search).get('cards') !== 'all' && choice.kind === 'card') {
        replace(`${cardClaimHref(handle, choice.slug)}${search}`)
        return
      }
      setState({ kind: 'venue', venue: result.body })
    }
    void load()
    return () => {
      current = false
    }
  }, [fetchVenue, generation, handle, mode, replace, search])

  if (state.kind === 'venue' && mode === 'home') {
    return (
      <StoreHome
        key={handle}
        venue={state.venue}
        locale={locale}
        origin={location.origin}
        requested={new URLSearchParams(search).get('card')}
      />
    )
  }
  const choice = state.kind === 'venue' ? selectEntry(state.venue) : null
  const view: CardScreenState =
    state.kind === 'venue'
      ? {
          defaultUnavailable: choice?.kind === 'choose' && choice.defaultUnavailable,
          heldSlugs: heldSlugsOf(state.venue),
          kind: 'choose',
          venue: state.venue,
        }
      : state
  return (
    <CardScreenView
      handle={handle}
      locale={locale}
      state={view}
      onIssue={noop}
      onReload={() => {
        setGeneration((value) => value + 1)
      }}
    />
  )
}
