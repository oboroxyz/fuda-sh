/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { CardScreen } from './CardScreen.tsx'
import { Landing } from './Landing.tsx'
import { PrivateScreen } from './PrivateScreen.tsx'
import { RightsList } from './RightsList.tsx'
import { routeFor } from './route.ts'
import { SignedGate } from './SignedGate.tsx'

// One Worker serves both the fuda.sh apex landing and app.fuda.sh (docs/specs/pass-types-and-flows.md#surfaces),
// so the route depends on the origin as well as the path; `routeFor` holds that
// decision and is tested on its own. `single-page-application` asset handling
// delivers index.html for /signed on either hostname.
export const App = (): JSX.Element => {
  const route = routeFor(
    globalThis.location.origin,
    `${globalThis.location.pathname}${globalThis.location.search}`,
  )
  if (route === 'signed') {
    return <SignedGate />
  }
  if (route === 'private') {
    return <PrivateScreen />
  }
  if (route === 'rights') {
    return <RightsList />
  }
  if (route === 'landing') {
    return <Landing />
  }
  if ('card' in route) {
    return <CardScreen handle={route.card} />
  }
  // The gate cannot work from the apex (the api would reject its origin), so
  // hand the browser to app.fuda.sh rather than render a screen that fails.
  globalThis.location.replace(route.redirect)
  return <div class="p-6">Taking you to the gate…</div>
}
