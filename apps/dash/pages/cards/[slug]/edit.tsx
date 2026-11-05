import type { ComponentChild } from 'preact'
import { useRouter } from 'void-preact'

import {
  readCardIntegrations,
  readStampSettings,
  updateCardIntegrations,
  updateStampSettings,
} from '../../../src/api.ts'
import { CardEditPage } from '../../../src/CardEditPage.tsx'
import { readOperatorCard, updateOperatorCard } from '../../../src/management-api.ts'
import { useCopy, useGuarded, useNavigate, useOperator, useRefresh } from '../../../src/page-context.tsx'
import { cardForRoute, routeFromPath } from '../../../src/router.ts'

// Also serves the retired `/cards/:id/stamps` URL for an id the venue does not
// own; a known one was already redirected to its edit URL.
export default function CardEdit(): ComponentChild {
  const copy = useCopy()
  const router = useRouter()
  const navigate = useNavigate()
  const guarded = useGuarded()
  const refresh = useRefresh()
  const { cards, issuer } = useOperator()
  const update = guarded(updateOperatorCard)
  return issuer === null ? null : (
    <CardEditPage
      card={cardForRoute(routeFromPath(router.path), cards)}
      copy={copy}
      integrations={{ load: guarded(readCardIntegrations), save: guarded(updateCardIntegrations) }}
      issuer={issuer}
      load={guarded(readOperatorCard)}
      onNavigate={navigate}
      save={async (cardId, body) => {
        const result = await update(cardId, body)
        if (result.ok) {
          await refresh()
        }
        return result
      }}
      settings={{ load: guarded(readStampSettings), save: guarded(updateStampSettings) }}
    />
  )
}
