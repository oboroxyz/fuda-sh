import { normalizeUid } from '@fuda/sdk'
import { useRouter } from '@void/solid'
import type { JSX } from 'solid-js'
import { Show } from 'solid-js'

import { memberQueryClient } from '../../src/member-context.tsx'
import { RightsList } from '../../src/member/RightsList.tsx'
import { useApp } from '../../src/page-context.tsx'

export default function Rights(): JSX.Element {
  const shared = useApp()
  const router = useRouter()
  const queryUid = () => {
    const raw = router.query.get('uid')
    return raw === null ? null : normalizeUid(raw)
  }
  return (
    <Show when={shared.signedIn && !shared.restoreFailed}>
      <RightsList
        locale={shared.locale}
        queryClient={memberQueryClient()}
        queryUid={queryUid()}
        syncWithAccount
      />
    </Show>
  )
}
