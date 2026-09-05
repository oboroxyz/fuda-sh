import { APP_ORIGIN } from './config.ts'

export type Route = 'landing' | 'signed' | 'private' | { redirect: string }

// The fuda.sh apex and app.fuda.sh are one Worker (spec §13), so the path alone
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
const APP_ONLY = new Set(['/signed', '/private'])

export const routeFor = (origin: string, pathname: string, appOrigin: string = APP_ORIGIN): Route => {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname
  const app = originOf(appOrigin)
  if (!APP_ONLY.has(path) || app === null) {
    return 'landing'
  }
  if (originOf(origin) !== app) {
    return { redirect: `${app}${path}` }
  }
  return path === '/signed' ? 'signed' : 'private'
}
