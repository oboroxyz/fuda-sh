import type { JSX } from 'solid-js'

import { PrivateScreen } from '../../src/member/PrivateScreen.tsx'
import { useApp } from '../../src/page-context.tsx'

export default function Private(): JSX.Element {
  const shared = useApp()
  return <PrivateScreen locale={shared.locale} />
}
