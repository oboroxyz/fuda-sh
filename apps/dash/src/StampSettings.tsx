/** @jsxImportSource hono/jsx/dom */
import type { StampSettings as StampSettingsValue } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { useCallback, useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'

export interface StampSettingsProps {
  copy: DashCopy['stamps']
  load: () => Promise<Result<StampSettingsValue>>
  save: (settings: StampSettingsValue) => Promise<Result<StampSettingsValue>>
}

export const StampSettings = ({ copy, load, save }: StampSettingsProps): JSX.Element => {
  const [settings, setSettings] = useState<StampSettingsValue | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'load' | 'save' | 'validation' | null>(null)
  const [saved, setSaved] = useState(false)
  const mounted = useRef(true)
  const loadRevision = useRef(0)
  const saveRevision = useRef(0)
  const saving = useRef(false)

  useEffect(
    () => () => {
      mounted.current = false
      loadRevision.current += 1
      saveRevision.current += 1
    },
    [],
  )

  const runLoad = useCallback((): void => {
    loadRevision.current += 1
    const ticket = loadRevision.current
    saveRevision.current += 1
    saving.current = false
    setSettings(null)
    setError(null)
    setSaved(false)
    setBusy(true)
    const run = async (): Promise<void> => {
      let result: Result<StampSettingsValue>
      try {
        result = await load()
      } catch {
        result = { error: 'network', network: true, ok: false, status: 0 }
      }
      if (!mounted.current || loadRevision.current !== ticket) {
        return
      }
      setBusy(false)
      if (result.ok) {
        setSettings(result.body)
      } else {
        setError('load')
      }
    }
    void run()
  }, [load])

  useEffect(() => {
    runLoad()
    return () => {
      loadRevision.current += 1
      saveRevision.current += 1
      saving.current = false
    }
  }, [runLoad, save])

  const valid =
    settings !== null &&
    Number.isInteger(settings.dailyLimit) &&
    settings.dailyLimit >= 1 &&
    settings.dailyLimit <= 100 &&
    Number.isInteger(settings.goal) &&
    settings.goal >= 1 &&
    settings.goal <= 1000

  const submit = (): void => {
    if (settings === null || saving.current) {
      return
    }
    if (!valid) {
      setError('validation')
      setSaved(false)
      return
    }
    saving.current = true
    saveRevision.current += 1
    const ticket = saveRevision.current
    const submitted = settings
    setBusy(true)
    setError(null)
    setSaved(false)
    const run = async (): Promise<void> => {
      let result: Result<StampSettingsValue>
      try {
        result = await save(submitted)
      } catch {
        result = { error: 'network', network: true, ok: false, status: 0 }
      }
      if (!mounted.current || saveRevision.current !== ticket) {
        return
      }
      saving.current = false
      setBusy(false)
      if (result.ok) {
        setSettings(result.body)
        setSaved(true)
      } else {
        setError('save')
      }
    }
    void run()
  }

  if (settings === null) {
    return (
      <div class="card flex items-start gap-3 p-5" role={error === 'load' ? 'alert' : 'status'}>
        <span>{busy ? copy.loading : copy.failures.load}</span>
        {error === 'load' ? (
          <button class="btn btn-sm" type="button" onClick={runLoad}>
            {copy.retry}
          </button>
        ) : null}
      </div>
    )
  }

  const numberInput = (
    label: string,
    value: number,
    max: number,
    update: (value: number) => void,
  ): JSX.Element => (
    <label class="flex flex-col gap-2">
      <span>{label}</span>
      <input
        class="input w-full"
        type="number"
        min="1"
        max={max}
        value={value}
        disabled={busy}
        onInput={(event) => {
          if (event.currentTarget instanceof HTMLInputElement) {
            update(Number(event.currentTarget.value))
            setSaved(false)
          }
        }}
      />
    </label>
  )

  return (
    <form
      noValidate
      class="card flex flex-col gap-5 px-6 py-8"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div class="space-y-1">
        <h2 class="text-xl font-bold">{copy.title}</h2>
        <p class="text-sm opacity-70">{copy.description}</p>
      </div>
      <label class="flex cursor-pointer items-center gap-3">
        <input
          class="toggle shrink-0"
          type="checkbox"
          checked={settings.enabled}
          disabled={busy}
          onChange={(event) => {
            if (event.currentTarget instanceof HTMLInputElement) {
              setSettings({ ...settings, enabled: event.currentTarget.checked })
              setSaved(false)
            }
          }}
        />
        <span>{copy.enabled}</span>
      </label>
      {numberInput(copy.dailyLimit, settings.dailyLimit, 100, (dailyLimit) => {
        setSettings({ ...settings, dailyLimit })
      })}
      {numberInput(copy.goal, settings.goal, 1000, (goal) => {
        setSettings({ ...settings, goal })
      })}
      {error === null ? null : (
        <p class="text-error" role="alert">
          {error === 'validation' ? copy.failures.validation : copy.failures[error]}
        </p>
      )}
      {saved ? <p role="status">{copy.saved}</p> : null}
      <button class="btn btn-primary self-start" disabled={busy} type="button" onClick={submit}>
        {busy ? copy.saving : copy.save}
      </button>
    </form>
  )
}
