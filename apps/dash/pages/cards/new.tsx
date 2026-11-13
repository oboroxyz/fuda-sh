import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { useRouter } from 'void-preact'

import type { CreateFailure } from '../../src/card-designer.ts'
import { cardDraft, setCardDraft } from '../../src/card-draft.ts'
import { CardDesigner } from '../../src/CardDesigner.tsx'
import { DEFAULT_DESIGN_IO, submitCard } from '../../src/design-actions.ts'
import { useCopy, useNavigate, useOperator, useSessionExpired } from '../../src/page-context.tsx'
import { slugCheck } from '../../src/venue-actions.ts'

export default function NewCard(): JSX.Element {
  const copy = useCopy()
  const router = useRouter()
  const navigate = useNavigate()
  const expired = useSessionExpired()
  const { issuer, operator } = useOperator()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<CreateFailure | null>(null)
  return (
    <CardDesigner
      requirementRegistries={operator?.requirementRegistries ?? []}
      busy={busy}
      copy={copy.designer}
      failure={failure}
      initialDraft={cardDraft()}
      issuer={issuer}
      onCheckSlug={slugCheck(expired)}
      onDraftChange={(form) => {
        setCardDraft(form)
      }}
      onEditProfile={(form) => {
        setCardDraft(form)
        navigate('/profile')
      }}
      onSubmit={(form) => {
        setFailure(null)
        setBusy(true)
        const run = async (): Promise<void> => {
          const outcome = await submitCard(DEFAULT_DESIGN_IO, form).catch(() => ({
            failure: 'network' as const,
            ok: false as const,
          }))
          setBusy(false)
          if (outcome.ok) {
            setCardDraft(null)
            await router.visit('/cards')
          } else if (outcome.failure === 'session') {
            expired()
          } else {
            setFailure(outcome.failure)
          }
        }
        void run()
      }}
    />
  )
}
