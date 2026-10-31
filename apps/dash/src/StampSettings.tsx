import type { StampSettings as StampSettingsValue } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'
import type { Accessor, JSX } from 'solid-js'

import type { DashCopy } from './copy.ts'

export interface StampSettingsProps {
  copy: DashCopy['stamps']
  load: () => Promise<Result<StampSettingsValue>>
  save: (settings: StampSettingsValue) => Promise<Result<StampSettingsValue>>
}

const valid = (current: StampSettingsValue): boolean =>
  Number.isInteger(current.dailyLimit) &&
  current.dailyLimit >= 1 &&
  current.dailyLimit <= 100 &&
  Number.isInteger(current.goal) &&
  current.goal >= 1 &&
  current.goal <= 1000

export const StampSettings = (props: StampSettingsProps): JSX.Element => {
  const [settings, setSettings] = createSignal<StampSettingsValue | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<'load' | 'save' | 'validation' | null>(null)
  const [saved, setSaved] = createSignal(false)
  let mounted = true
  let loadRevision = 0
  let saveRevision = 0
  let saving = false

  onCleanup(() => {
    mounted = false
    loadRevision += 1
    saveRevision += 1
  })

  const runLoad = (): void => {
    loadRevision += 1
    const ticket = loadRevision
    saveRevision += 1
    saving = false
    setSettings(null)
    setError(null)
    setSaved(false)
    setBusy(true)
    const run = async (): Promise<void> => {
      let result: Result<StampSettingsValue>
      try {
        result = await props.load()
      } catch {
        result = { error: 'network', network: true, ok: false, status: 0 }
      }
      if (!mounted || loadRevision !== ticket) {
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
  }

  // A new loader (another card, or a replaced session) starts over; a late
  // answer for the previous one is dropped.
  createEffect(on(() => props.load, runLoad))

  const submit = (): void => {
    const submitted = settings()
    if (submitted === null || saving) {
      return
    }
    if (!valid(submitted)) {
      setError('validation')
      setSaved(false)
      return
    }
    saving = true
    saveRevision += 1
    const ticket = saveRevision
    setBusy(true)
    setError(null)
    setSaved(false)
    const run = async (): Promise<void> => {
      let result: Result<StampSettingsValue>
      try {
        result = await props.save(submitted)
      } catch {
        result = { error: 'network', network: true, ok: false, status: 0 }
      }
      if (!mounted || saveRevision !== ticket) {
        return
      }
      saving = false
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

  const numberInput = (
    label: string,
    value: () => number,
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
        value={value()}
        disabled={busy()}
        onInput={(event) => {
          update(Number(event.currentTarget.value))
          setSaved(false)
        }}
      />
    </label>
  )

  const editor = (current: Accessor<StampSettingsValue>): JSX.Element => (
    <form
      noValidate
      class="card flex flex-col gap-5 px-6 py-8"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div class="space-y-1">
        <h2 class="text-xl font-bold">{props.copy.title}</h2>
        <p class="text-sm opacity-70">{props.copy.description}</p>
      </div>
      <label class="flex cursor-pointer items-center gap-3">
        <input
          class="toggle shrink-0"
          type="checkbox"
          checked={current().enabled}
          disabled={busy()}
          onInput={(event) => {
            setSettings({ ...current(), enabled: event.currentTarget.checked })
            setSaved(false)
          }}
        />
        <span>{props.copy.enabled}</span>
      </label>
      {numberInput(
        props.copy.dailyLimit,
        () => current().dailyLimit,
        100,
        (dailyLimit) => {
          setSettings({ ...current(), dailyLimit })
        },
      )}
      {numberInput(
        props.copy.goal,
        () => current().goal,
        1000,
        (goal) => {
          setSettings({ ...current(), goal })
        },
      )}
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
      when={settings()}
      fallback={
        <div class="card flex items-start gap-3 p-5" role={error() === 'load' ? 'alert' : 'status'}>
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
