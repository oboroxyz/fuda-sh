import type { JSX } from 'solid-js'

import { SignedGate } from '../../src/member/SignedGate.tsx'
import { useApp } from '../../src/page-context.tsx'

export default function Signed(): JSX.Element {
  const shared = useApp()
  return <SignedGate locale={shared.locale} />
}
