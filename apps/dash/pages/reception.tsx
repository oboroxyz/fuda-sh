import type { JSX } from 'solid-js'

import { receiveAtReception } from '../src/api.ts'
import { useCopy, useGuarded } from '../src/page-context.tsx'
import { ReceptionPage } from '../src/ReceptionPage.tsx'

export default function Reception(): JSX.Element {
  const copy = useCopy()
  const guarded = useGuarded()
  return <ReceptionPage copy={copy().reception} receive={guarded(receiveAtReception)} />
}
