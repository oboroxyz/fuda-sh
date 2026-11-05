import type { CardIntegrations } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'

import type { DashCopy } from './copy.ts'
import { settled } from './network-result.ts'
import { SettingsFooter, SettingsLoadState } from './SettingsParts.tsx'
import { useLifetime } from './use-lifetime.ts'

export interface CardIntegrationsIo {
  load: (cardId: string) => Promise<Result<CardIntegrations>>
  save: (cardId: string, value: CardIntegrations) => Promise<Result<CardIntegrations>>
}

export interface IntegrationSettingsProps {
  cardId: string
  copy: DashCopy['integrations']
  io: CardIntegrationsIo
}

// A Card's optional services (docs/specs/pass-types-and-flows.md#card-integrations),
// saved apart from the Card the way Stamp settings are. Each row is one
// integration with its own switch; the whole object is saved together, and
// every switch starts off, so a Card offers nothing its operator did not turn on.
export const IntegrationSettings = (props: IntegrationSettingsProps): JSX.Element => {
  const [value, setValue] = useState<CardIntegrations | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'load' | 'save' | null>(null)
  const [saved, setSaved] = useState(false)
  const { mounted, revision } = useLifetime()

  const runLoad = (): void => {
    revision.current += 1
    const ticket = revision.current
    const { cardId } = props
    setValue(null)
    setError(null)
    setSaved(false)
    setBusy(true)
    const run = async (): Promise<void> => {
      const result = await settled(async () => await props.io.load(cardId))
      if (!mounted.current || revision.current !== ticket) {
        return
      }
      setBusy(false)
      if (result.ok) {
        setValue(result.body)
      } else {
        setError('load')
      }
    }
    void run()
  }

  // Reload when the Card changes; a re-render with the same Card keeps an
  // unsaved switch.
  useEffect(runLoad, [props.cardId])

  const submit = (): void => {
    const submitted = value
    if (submitted === null || busy) {
      return
    }
    revision.current += 1
    const ticket = revision.current
    const { cardId } = props
    setBusy(true)
    setError(null)
    setSaved(false)
    const run = async (): Promise<void> => {
      const result = await settled(async () => await props.io.save(cardId, submitted))
      if (!mounted.current || revision.current !== ticket) {
        return
      }
      setBusy(false)
      if (result.ok) {
        setValue(result.body)
        setSaved(true)
      } else {
        setError('save')
      }
    }
    void run()
  }

  const editor = (current: CardIntegrations): JSX.Element => (
    <form
      noValidate
      class="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <label class="flex cursor-pointer items-start gap-3">
        <input
          class="toggle mt-1 shrink-0"
          type="checkbox"
          checked={current.badges.includes('human')}
          disabled={busy}
          onInput={(event) => {
            setValue({ badges: event.currentTarget.checked ? ['human'] : [] })
            setSaved(false)
          }}
        />
        <span class="flex flex-col gap-1">
          <span class="font-medium">{props.copy.worldId}</span>
          <span class="text-sm opacity-70">{props.copy.worldIdHint}</span>
        </span>
      </label>
      <SettingsFooter
        busy={busy}
        copy={props.copy}
        error={error}
        failures={props.copy.failures}
        onSubmit={submit}
        saved={saved}
      />
    </form>
  )

  return value === null ? (
    <SettingsLoadState
      busy={busy}
      class="flex items-start gap-3"
      copy={props.copy}
      failed={error === 'load'}
      onRetry={runLoad}
    />
  ) : (
    editor(value)
  )
}
