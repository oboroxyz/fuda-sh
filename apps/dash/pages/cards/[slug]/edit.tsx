import { useRouter } from '@void/solid'
import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

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
export default function CardEdit(): JSX.Element {
  const copy = useCopy()
  const router = useRouter()
  const navigate = useNavigate()
  const guarded = useGuarded()
  const refresh = useRefresh()
  const { cards, issuer } = useOperator()
  const update = guarded(updateOperatorCard)
  return (
    <Show when={issuer()}>
      {(current) => (
        <CardEditPage
          card={cardForRoute(routeFromPath(router.path), cards())}
          copy={copy()}
          integrations={{ load: guarded(readCardIntegrations), save: guarded(updateCardIntegrations) }}
          issuer={current()}
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
      )}
    </Show>
  )
}
