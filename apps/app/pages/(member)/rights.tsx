import { normalizeUid } from '@fuda/sdk'
import type { JSX } from 'preact'
import { useRouter } from 'void-preact'

import { memberQueryClient } from '../../src/member-context.tsx'
import { RightsList } from '../../src/member/RightsList.tsx'
import { useApp } from '../../src/page-context.tsx'

export default function Rights(): JSX.Element | null {
  const shared = useApp()
  const router = useRouter()
  const queryUid = () => {
    const raw = router.query.get('uid')
    return raw === null ? null : normalizeUid(raw)
  }
  return shared.signedIn && !shared.restoreFailed ? (
    <RightsList
      locale={shared.locale}
      queryClient={memberQueryClient()}
      queryUid={queryUid()}
      syncWithAccount
    />
  ) : null
}
