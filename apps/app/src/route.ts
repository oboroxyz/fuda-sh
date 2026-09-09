import { isIssuerHandle } from '@fuda/sdk'

import { APP_ORIGIN } from './config.ts'

export type Route =
  | 'top'
  | 'signin'
  | 'signed'
  | 'private'
  | 'rights'
  | 'settings'
  | { card: string; slug: string | null }
  | { redirect: string }

// The member Worker runs at app.fuda.sh. The separately served apex may hand
// older deep links to this router, so app-only paths retain an origin redirect.
// The api's CORS policy likewise requires member actions to run on app.fuda.sh.

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
const MEMBER_PATHS = new Set(['/signin', '/signed', '/private', '/rights', '/settings'])
const PROTECTED_MEMBER_PATHS = new Set(['/signed', '/private', '/rights', '/settings'])

export const safeMemberReturn = (target: string | null): string => {
  if (target === null || !target.startsWith('/') || target.startsWith('//')) {
    return '/rights'
  }
  const queryAt = target.indexOf('?')
  const path = queryAt === -1 ? target : target.slice(0, queryAt)
  return PROTECTED_MEMBER_PATHS.has(path) ? target : '/rights'
}

// A venue owns its full /@<handle>/* prefix. The handle must be valid, while an
// unmatched suffix still reaches CardScreen so its missing-card recovery stays
// within the venue instead of falling through to the member top.
const CARD_PATH = /^\/@(?<handle>[^/]+)(?:\/(?<slug>.+))?$/u

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
  return { card: handle, slug }
}

export const routeFor = (origin: string, pathname: string, appOrigin: string = APP_ORIGIN): Route => {
  const queryAt = pathname.indexOf('?')
  const query = queryAt === -1 ? '' : pathname.slice(queryAt)
  const pathInput = queryAt === -1 ? pathname : pathname.slice(0, queryAt)
  const path = pathInput.length > 1 ? pathInput.replace(/\/+$/u, '') : pathInput
  const app = originOf(appOrigin)
  const card = cardRouteOf(path)
  if (path === '/') {
    return 'top'
  }
  if ((card === null && !MEMBER_PATHS.has(path)) || app === null) {
    return 'top'
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
  if (path === '/private') {
    return 'private'
  }
  if (path === '/settings') {
    return 'settings'
  }
  return path === '/signin' ? 'signin' : 'rights'
}
