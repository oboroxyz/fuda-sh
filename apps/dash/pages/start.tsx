import type { JSX } from 'preact'
import { useState } from 'preact/hooks'

import type { CreateFailure } from '../src/card-designer.ts'
import { useCardDraft } from '../src/card-draft.ts'
import { DEFAULT_DESIGN_IO, submitVenue } from '../src/design-actions.ts'
import { useCopy, useNavigate, useSessionExpired } from '../src/page-context.tsx'
import { handleCheck } from '../src/venue-actions.ts'
import { VenuePage } from '../src/VenuePage.tsx'

// Registration: an operator without a venue creates one, then lands on its profile.
export default function Start(): JSX.Element {
  const copy = useCopy()
  const cardDraft = useCardDraft()
  const navigate = useNavigate()
  const expired = useSessionExpired()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<CreateFailure | null>(null)
  return (
    <VenuePage
      busy={busy}
      copy={copy}
      ens={null}
      failure={failure}
      hasCardDraft={cardDraft !== null}
      issuer={null}
      onCheckHandle={handleCheck(expired)}
      onCommitLogo={async () => await Promise.resolve(false)}
      onCreate={(form, logo) => {
        setFailure(null)
        setBusy(true)
        const run = async (): Promise<void> => {
          const outcome = await submitVenue(DEFAULT_DESIGN_IO, form, logo).catch(() => ({
            failure: 'network' as const,
            ok: false as const,
          }))
          setBusy(false)
          if (outcome.ok) {
            window.location.assign('/profile')
          } else if (outcome.failure === 'session') {
            expired()
          } else {
            setFailure(outcome.failure)
          }
        }
        void run()
      }}
      onNavigate={navigate}
      onUpdate={async () => await Promise.resolve(false)}
      publicUrl={null}
    />
  )
}
