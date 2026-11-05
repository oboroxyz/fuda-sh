import type { JSX } from 'preact'

import { GRAPH_RIGHTS_ENDPOINT } from '../src/config.ts'
import { OverviewPage } from '../src/OverviewPage.tsx'
import { useCopy } from '../src/page-context.tsx'
import type { Props } from './index.server.ts'

export default function Overview(props: Props): JSX.Element {
  const copy = useCopy()
  return (
    <OverviewPage
      apiBaseUrl={props.apiBaseUrl}
      copy={copy.overview}
      graphEndpoint={GRAPH_RIGHTS_ENDPOINT}
      state={props.members}
    />
  )
}
