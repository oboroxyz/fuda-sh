import type { JSX } from 'solid-js'

import { IssuerPassesPage } from '../src/IssuerPassesPage.tsx'
import { listIssuerPasses } from '../src/management-api.ts'
import { useCopy, useGuarded, useOperator } from '../src/page-context.tsx'

export default function Passes(): JSX.Element {
  const copy = useCopy()
  const guarded = useGuarded()
  const { cards } = useOperator()
  return <IssuerPassesPage cards={cards()} copy={copy().management} load={guarded(listIssuerPasses)} />
}
