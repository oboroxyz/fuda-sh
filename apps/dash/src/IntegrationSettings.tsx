import type { CardIntegrations } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'
import type { Accessor, JSX } from 'solid-js'

import type { DashCopy } from './copy.ts'

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
  const [value, setValue] = createSignal<CardIntegrations | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<'load' | 'save' | null>(null)
  const [saved, setSaved] = createSignal(false)
  let mounted = true
  let revision = 0

  onCleanup(() => {
    mounted = false
    revision += 1
  })

  const runLoad = (): void => {
    revision += 1
    const ticket = revision
    const { cardId } = props
    setValue(null)
    setError(null)
    setSaved(false)
    setBusy(true)
    const run = async (): Promise<void> => {
      let result: Result<CardIntegrations>
      try {
        result = await props.io.load(cardId)
      } catch {
        result = { error: 'network', network: true, ok: false, status: 0 }
      }
      if (!mounted || revision !== ticket) {
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
  createEffect(on(() => props.cardId, runLoad))

  const submit = (): void => {
    const submitted = value()
    if (submitted === null || busy()) {
      return
    }
    revision += 1
    const ticket = revision
    const { cardId } = props
    setBusy(true)
    setError(null)
    setSaved(false)
    const run = async (): Promise<void> => {
      let result: Result<CardIntegrations>
      try {
        result = await props.io.save(cardId, submitted)
      } catch {
        result = { error: 'network', network: true, ok: false, status: 0 }
      }
      if (!mounted || revision !== ticket) {
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

  const editor = (current: Accessor<CardIntegrations>): JSX.Element => (
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
          checked={current().badges.includes('human')}
          disabled={busy()}
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
      {error() === null ? null : (
        <p class="text-error" role="alert">
          {props.copy.failures[error() ?? 'load']}
        </p>
      )}
      {saved() ? <p role="status">{props.copy.saved}</p> : null}
      <button class="btn btn-primary self-start" disabled={busy()} type="button" onClick={submit}>
        {busy() ? props.copy.saving : props.copy.save}
      </button>
    </form>
  )

  return (
    <Show
      when={value()}
      fallback={
        <div class="flex items-start gap-3" role={error() === 'load' ? 'alert' : 'status'}>
          <span>{busy() ? props.copy.loading : props.copy.failures.load}</span>
          {error() === 'load' ? (
            <button class="btn btn-sm" type="button" onClick={runLoad}>
              {props.copy.retry}
            </button>
          ) : null}
        </div>
      }
    >
      {(current) => editor(current)}
    </Show>
  )
}
