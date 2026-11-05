import type { JSX } from 'preact'

import { Landing } from '../src/member/Landing.tsx'
import { Appearance, useApp, useNavigate } from '../src/page-context.tsx'

export default function Top(): JSX.Element {
  const shared = useApp()
  const navigate = useNavigate()
  return (
    <div class="app-top">
      <Appearance />
      <Landing locale={shared.locale} onNavigate={navigate} signedIn={shared.signedIn} />
    </div>
  )
}
