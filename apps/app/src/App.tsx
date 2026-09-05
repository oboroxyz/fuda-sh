/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { Landing } from './Landing.tsx'
import { SignedGate } from './SignedGate.tsx'

// One Worker serves both the fuda.sh apex landing and app.fuda.sh (spec §13),
// so the route is read from the path once at render; `single-page-application`
// asset handling delivers index.html for /signed.
export const App = (): JSX.Element =>
  globalThis.location.pathname === '/signed' ? <SignedGate /> : <Landing />
