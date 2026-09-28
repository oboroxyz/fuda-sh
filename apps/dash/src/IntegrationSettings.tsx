/** @jsxImportSource hono/jsx/dom */
import type { CardIntegrations } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { useCallback, useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

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
export const IntegrationSettings = ({ cardId, copy, io }: IntegrationSettingsProps): JSX.Element => {
  const [value, setValue] = useState<CardIntegrations | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'load' | 'save' | null>(null)
  const [saved, setSaved] = useState(false)
  const mounted = useRef(true)
  const revision = useRef(0)

  useEffect(
    () => () => {
      mounted.current = false
      revision.current += 1
    },
    [],
  )

  const runLoad = useCallback((): void => {
    revision.current += 1
    const ticket = revision.current
    setValue(null)
    setError(null)
    setSaved(false)
    setBusy(true)
    const run = async (): Promise<void> => {
      let result: Result<CardIntegrations>
      try {
        result = await io.load(cardId)
      } catch {
        result = { error: 'network', network: true, ok: false, status: 0 }
      }
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
  }, [cardId, io])

  useEffect(() => {
    runLoad()
    return () => {
      revision.current += 1
    }
  }, [runLoad])

  const submit = (): void => {
    if (value === null || busy) {
      return
    }
    revision.current += 1
    const ticket = revision.current
    const submitted = value
    setBusy(true)
    setError(null)
    setSaved(false)
    const run = async (): Promise<void> => {
      let result: Result<CardIntegrations>
      try {
        result = await io.save(cardId, submitted)
      } catch {
        result = { error: 'network', network: true, ok: false, status: 0 }
      }
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

  if (value === null) {
    return (
      <div class="flex items-start gap-3" role={error === 'load' ? 'alert' : 'status'}>
        <span>{busy ? copy.loading : copy.failures.load}</span>
        {error === 'load' ? (
          <button class="btn btn-sm" type="button" onClick={runLoad}>
            {copy.retry}
          </button>
        ) : null}
      </div>
    )
  }

  const humanOn = value.badges.includes('human')
  return (
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
          checked={humanOn}
          disabled={busy}
          onChange={(event) => {
            if (event.currentTarget instanceof HTMLInputElement) {
              setValue({ badges: event.currentTarget.checked ? ['human'] : [] })
              setSaved(false)
            }
          }}
        />
        <span class="flex flex-col gap-1">
          <span class="font-medium">{copy.worldId}</span>
          <span class="text-sm opacity-70">{copy.worldIdHint}</span>
        </span>
      </label>
      {error === null ? null : (
        <p class="text-error" role="alert">
          {copy.failures[error]}
        </p>
      )}
      {saved ? <p role="status">{copy.saved}</p> : null}
      <button class="btn btn-primary self-start" disabled={busy} type="button" onClick={submit}>
        {busy ? copy.saving : copy.save}
      </button>
    </form>
  )
}
