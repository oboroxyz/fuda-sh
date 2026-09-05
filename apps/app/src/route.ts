import { APP_ORIGIN } from './config.ts'

export type Route = 'landing' | 'signed' | { redirect: string }

// The fuda.sh apex and app.fuda.sh are one Worker (spec §13), so the path alone
// does not say which surface the browser is on. The Signed gate must run on the
// app origin: it is the only one the api's CORS list allows, so rendering it at
// the apex would fail every /challenge with the network banner. The apex answers
// the landing and hands /signed over to app.fuda.sh instead.
export const routeFor = (origin: string, pathname: string, appOrigin: string = APP_ORIGIN): Route => {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname
  if (path !== '/signed') {
    return 'landing'
  }
  return origin === appOrigin ? 'signed' : { redirect: `${appOrigin}/signed` }
}
