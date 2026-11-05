import type { StampSettings as StampSettingsValue } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { DashCopy } from './copy.ts'
import { settled } from './network-result.ts'
import { SettingsFooter, SettingsLoadState } from './SettingsParts.tsx'

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
  const [settings, setSettings] = useState<StampSettingsValue | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'load' | 'save' | 'validation' | null>(null)
  const [saved, setSaved] = useState(false)
  const mounted = useRef(true)
  const loadRevision = useRef(0)
  const saveRevision = useRef(0)
  const saving = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      loadRevision.current += 1
      saveRevision.current += 1
    }
  }, [])

  const runLoad = (): void => {
    loadRevision.current += 1
    const ticket = loadRevision.current
    saveRevision.current += 1
    saving.current = false
    setSettings(null)
    setError(null)
    setSaved(false)
    setBusy(true)
    const run = async (): Promise<void> => {
      const result = await settled(async () => await props.load())
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
  }

  // A new loader (another card, or a replaced session) starts over; a late
  // answer for the previous one is dropped.
  useEffect(runLoad, [props.load])

  const submit = (): void => {
    const submitted = settings
    if (submitted === null || saving.current) {
      return
    }
    if (!valid(submitted)) {
      setError('validation')
      setSaved(false)
      return
    }
    saving.current = true
    saveRevision.current += 1
    const ticket = saveRevision.current
    setBusy(true)
    setError(null)
    setSaved(false)
    const run = async (): Promise<void> => {
      const result = await settled(async () => await props.save(submitted))
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
          update(Number(event.currentTarget.value))
          setSaved(false)
        }}
      />
    </label>
  )

  const editor = (current: StampSettingsValue): JSX.Element => (
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
          checked={current.enabled}
          disabled={busy}
          onInput={(event) => {
            const { checked } = event.currentTarget
            setSettings((latest) => (latest === null ? latest : { ...latest, enabled: checked }))
            setSaved(false)
          }}
        />
        <span>{props.copy.enabled}</span>
      </label>
      {numberInput(props.copy.dailyLimit, current.dailyLimit, 100, (dailyLimit) => {
        setSettings((latest) => (latest === null ? latest : { ...latest, dailyLimit }))
      })}
      {numberInput(props.copy.goal, current.goal, 1000, (goal) => {
        setSettings((latest) => (latest === null ? latest : { ...latest, goal }))
      })}
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

  return settings === null ? (
    <SettingsLoadState
      busy={busy}
      class="card flex items-start gap-3 p-5"
      copy={props.copy}
      failed={error === 'load'}
      onRetry={runLoad}
    />
  ) : (
    editor(settings)
  )
}
