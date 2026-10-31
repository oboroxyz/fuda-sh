import type { JSX } from 'solid-js'
import { Show } from 'solid-js'

import { updateDefaultCard } from '../../src/api.ts'
import { listIssuerPasses } from '../../src/management-api.ts'
import { useCopy, useGuarded, useNavigate, useOperator, useRefresh } from '../../src/page-context.tsx'
import { PublishedCard } from '../../src/PublishedCard.tsx'
import { cardEditPath } from '../../src/router.ts'

export default function Cards(): JSX.Element {
  const copy = useCopy()
  const navigate = useNavigate()
  const guarded = useGuarded()
  const refresh = useRefresh()
  const { cards, issuer, publicUrl } = useOperator()
  const setDefault = guarded(async (slug: string | null) => await updateDefaultCard({ slug }))
  return (
    <Show when={issuer()}>
      {(current) => (
        <PublishedCard
          cards={cards()}
          copy={copy().published}
          issuer={current()}
          loadPasses={guarded(listIssuerPasses)}
          managementCopy={copy().management}
          onAddCard={() => {
            navigate('/cards/new')
          }}
          onDefaultCard={async (slug) => {
            const result = await setDefault(slug).catch(() => null)
            if (result?.ok !== true) {
              return false
            }
            await refresh()
            return true
          }}
          onNavigate={navigate}
          onSettings={(cardId) => {
            const selected = cards().find((card) => card.id === cardId)
            if (selected !== undefined) {
              navigate(cardEditPath(selected))
            }
          }}
          publicUrl={publicUrl() ?? ''}
        />
      )}
    </Show>
  )
}
