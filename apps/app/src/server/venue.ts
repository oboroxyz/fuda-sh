import { apiHeaders } from '@fuda/libs/worker'
import type { PublicVenue } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'
import type { Context } from 'hono'

import { isCardRoute, isHomeRoute, routeFor } from '../route.ts'
import { cardClaimHref, selectEntry } from '../venue/entry.ts'

export type VenuePage =
  | { kind: 'card'; handle: string; slug: string }
  | { kind: 'entry'; handle: string }
  | { kind: 'home'; handle: string }

// A `/@<handle>` URL as the page it shows: the venue's entry, its store
// display, or one card. null for any other path.
export const venuePageOf = (url: URL, appOrigin: string): VenuePage | null => {
  const route = routeFor(url.origin, `${url.pathname}${url.search}`, appOrigin)
  if (isHomeRoute(route)) {
    return { handle: route.home, kind: 'home' }
  }
  if (isCardRoute(route)) {
    return route.slug === null
      ? { handle: route.card, kind: 'entry' }
      : { handle: route.card, kind: 'card', slug: route.slug }
  }
  return null
}

export interface VenueProps {
  page: VenuePage
  // The development-only store preview (docs/runbook.md) replaces the page.
  preview: boolean
  // The public venue as the server read it; the page shows it without a
  // second request from the browser.
  venue: Result<PublicVenue>
}

// The venue for a `/@<handle>` page. A bare venue URL whose entry is one card
// goes straight to that card, as the browser used to after its own read.
export const loadVenue = async (
  c: Context,
  url: URL,
  apiBaseUrl: string,
  appOrigin: string,
): Promise<VenueProps | Response> => {
  const page = venuePageOf(url, appOrigin)
  if (page === null) {
    return c.redirect('/')
  }
  if (import.meta.env.DEV && import.meta.env.VITE_STORE_PREVIEW === '1') {
    return { page, preview: true, venue: { error: 'preview', network: false, ok: false, status: 0 } }
  }
  const venue = await apiFetch<PublicVenue>(apiBaseUrl, `/issuers/${encodeURIComponent(page.handle)}`, {
    headers: apiHeaders(c, null),
    method: 'GET',
  })
  if (page.kind === 'entry' && venue.ok && url.searchParams.get('cards') !== 'all') {
    const choice = selectEntry(venue.body)
    if (choice.kind === 'card') {
      return c.redirect(`${cardClaimHref(page.handle, choice.slug)}${url.search}`)
    }
  }
  return { page, preview: false, venue }
}
