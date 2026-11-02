import type { JSX } from 'solid-js'

import { APPS_COPY } from '../src/apps-copy.ts'
import {
  deleteConnectedApp,
  listActivity,
  listConnectedApps,
  listGrants,
  registerConnectedApp,
  revokeGrant,
} from '../src/connected-apps-api.ts'
import { ConnectedAppsPage } from '../src/ConnectedAppsPage.tsx'
import { useDash, useGuarded } from '../src/page-context.tsx'

export default function Apps(): JSX.Element {
  const shared = useDash()
  const guarded = useGuarded()
  return (
    <ConnectedAppsPage
      copy={APPS_COPY[shared.locale]}
      io={{
        activity: guarded(listActivity),
        grants: guarded(listGrants),
        list: guarded(listConnectedApps),
        register: guarded(registerConnectedApp),
        remove: guarded(deleteConnectedApp),
        revoke: guarded(revokeGrant),
      }}
    />
  )
}
