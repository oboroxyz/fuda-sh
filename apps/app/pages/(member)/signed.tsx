import type { JSX } from 'preact'

import { SignedGate } from '../../src/member/SignedGate.tsx'
import { useApp } from '../../src/page-context.tsx'

export default function Signed(): JSX.Element {
  const shared = useApp()
  return <SignedGate locale={shared.locale} />
}
