import { isCardSlug, isIssuerHandle } from '@fuda/sdk'

import { APP_ORIGIN } from './config.ts'

export type Route =
  | 'landing'
  | 'signed'
  | 'private'
  | 'rights'
  | { card: string; slug: string | null }
  | { redirect: string }

// The fuda.sh apex and app.fuda.sh are one Worker (docs/specs/pass-types-and-flows.md#surfaces), so the path alone
// does not say which surface the browser is on. The Signed gate must run on the
// app origin: it is the only one the api's CORS list allows, so rendering it at
// the apex would fail every /challenge with the network banner. The apex answers
// the landing and hands /signed over to app.fuda.sh instead.

// An origin is compared by what the URL parser makes of it, not by its spelling:
// a VITE_APP_ORIGIN with a trailing slash or an upper-case host would otherwise
// never equal `location.origin` and the gate would redirect to itself forever.
// `URL` reports an opaque origin as the string "null", which is no origin at all.
const originOf = (value: string): string | null => {
  if (!URL.canParse(value)) {
    return null
  }
  const { origin } = new URL(value)
  return origin === 'null' ? null : origin
}

// +Private is an extension of Signed, not a separate surface: /private answers
// to the same origin rule as /signed.
const APP_ONLY = new Set(['/signed', '/private', '/rights'])

// A venue lives at /@<handle> and each of its cards at /@<handle>/<slug>. The
// handle and slug rules are the sdk's, so a path the api would answer 404 for
// (a reserved word like /@www, or a reserved slug like /cards) is not a card
// route at all and falls through to the landing.
const CARD_PATH = /^\/@(?<handle>[^/]+)(?:\/(?<slug>[^/]+))?$/u

export interface CardRoute {
  card: string
  slug: string | null
}

const cardRouteOf = (path: string): CardRoute | null => {
  const groups = CARD_PATH.exec(path)?.groups
  if (groups === undefined) {
    return null
  }
  const { handle, slug } = groups
  if (handle === undefined || !isIssuerHandle(handle)) {
    return null
  }
  if (slug === undefined) {
    return { card: handle, slug: null }
  }
  return isCardSlug(slug) ? { card: handle, slug } : null
}

export const routeFor = (origin: string, pathname: string, appOrigin: string = APP_ORIGIN): Route => {
  const queryAt = pathname.indexOf('?')
  const query = queryAt === -1 ? '' : pathname.slice(queryAt)
  const pathInput = queryAt === -1 ? pathname : pathname.slice(0, queryAt)
  const path = pathInput.length > 1 ? pathInput.replace(/\/+$/u, '') : pathInput
  const app = originOf(appOrigin)
  const card = cardRouteOf(path)
  if ((card === null && !APP_ONLY.has(path)) || app === null) {
    return 'landing'
  }
  if (originOf(origin) !== app) {
    return { redirect: `${app}${path}${query}` }
  }
  if (card !== null) {
    return card
  }
  if (path === '/signed') {
    return 'signed'
  }
  return path === '/private' ? 'private' : 'rights'
}
