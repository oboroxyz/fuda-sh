import type { JSX } from 'preact'

import { revokeRight } from '../src/api.ts'
import { GRAPH_RIGHTS_ENDPOINT } from '../src/config.ts'
import { useCopy, useRefresh, useSessionExpired } from '../src/page-context.tsx'
import { RightsPage } from '../src/RightsPage.tsx'
import type { Props } from './rights.server.ts'

export default function Rights(props: Props): JSX.Element {
  const copy = useCopy()
  const refresh = useRefresh()
  const expired = useSessionExpired()
  return (
    <RightsPage
      copy={copy}
      graphEndpoint={GRAPH_RIGHTS_ENDPOINT}
      members={props.members}
      onRevoke={async (uid) => {
        const result = await revokeRight(uid)
        if (result.ok) {
          await refresh()
        } else if (result.status === 401) {
          expired()
        }
        return result
      }}
    />
  )
}
