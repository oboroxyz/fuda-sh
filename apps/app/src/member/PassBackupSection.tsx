import { pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import type { JSX } from 'preact'
import { useState } from 'preact/hooks'

import { fetchPassBackup, uidFromBackupFile } from '../pass-backup.ts'
import { rememberPass } from '../pass-memory.ts'
import { MEMBER_COPY } from './copy.ts'

type Outcome = 'failed' | 'invalid' | 'restored' | 'restoredPasskey'

// docs/specs/pass-types-and-flows.md#keeping-a-pass-without-a-provider. A member who
// lost every device reads a pass back from a backup they saved themselves.
export const PassBackupSection = (props: { locale: Locale }): JSX.Element => {
  const copy = (): (typeof MEMBER_COPY)[Locale]['backup'] => pick(MEMBER_COPY, props.locale).backup
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const read = async (file: File): Promise<void> => {
    setOutcome(null)
    const uid = uidFromBackupFile(await file.text())
    if (uid === null) {
      setOutcome('invalid')
      return
    }
    const backup = await fetchPassBackup(uid)
    if (!backup.ok) {
      setOutcome(backup.status === 404 || backup.status === 400 ? 'invalid' : 'failed')
      return
    }
    rememberPass({ holder: backup.body.holder, uid })
    setOutcome(backup.body.passkey ? 'restoredPasskey' : 'restored')
  }

  return (
    <section class="flex flex-col gap-3">
      <h2 class="text-sm font-semibold">{copy().title}</h2>
      <p class="text-sm text-[var(--fuda-muted)]">{copy().hint}</p>
      <label class="flex flex-col gap-1">
        <span class="text-sm">{copy().choose}</span>
        <input
          accept="application/json,.json"
          class="file-input w-full"
          type="file"
          onInput={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file !== undefined) {
              void read(file)
            }
          }}
        />
      </label>
      {outcome ? (
        <div
          class={outcome.startsWith('restored') ? 'alert alert-success' : 'alert alert-error'}
          role="status"
        >
          {copy().outcomes[outcome]}
        </div>
      ) : null}
    </section>
  )
}
