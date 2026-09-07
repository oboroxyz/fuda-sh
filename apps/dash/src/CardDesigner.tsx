/** @jsxImportSource hono/jsx/dom */
import type { CardCategory } from '@fuda/sdk'
import { cn } from 'cn'
import { useCallback, useEffect, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { BRAND_SWATCHES, canSubmit, EMPTY_FORM, EXPIRY_CHOICES, handleStatusOf } from './card-designer.ts'
import type { CreateFailure, DesignerForm, ExpiryChoice, HandleStatus } from './card-designer.ts'
import type { DashCopy } from './copy.ts'

export interface CardDesignerViewProps {
  busy: boolean
  copy: DashCopy['designer']
  failure: CreateFailure | null
  form: DesignerForm
  locationDenied: boolean
  onField: <K extends keyof DesignerForm>(key: K, value: DesignerForm[K]) => void
  onLockScreen: (on: boolean) => void
  onSubmit: () => void
  status: HandleStatus
}

const expiryLabel = (copy: DashCopy['designer'], days: ExpiryChoice): string =>
  days === null ? copy.expiryNone : copy.expiryDays.replace('{days}', String(days))

// The select's values are the choices themselves, so an unexpected one — a
// stale DOM, a translated build — means "no expiry" rather than a bad number.
const expiryFromValue = (raw: string): ExpiryChoice =>
  EXPIRY_CHOICES.find((choice) => choice !== null && String(choice) === raw) ?? null

const statusLabel = (copy: DashCopy['designer'], status: HandleStatus): string | null =>
  status === 'idle' ? null : copy.handleStatus[status]

const preview = (copy: DashCopy['designer'], form: DesignerForm): JSX.Element => (
  <div class="dash-card-preview" style={{ background: form.brandColor }}>
    <div class="dash-card-preview-top">
      <span>{form.name === '' ? copy.namePlaceholder : form.name}</span>
      <span>{form.category === 'ticket' ? copy.ticket : copy.membership}</span>
    </div>
    <strong>{form.title}</strong>
    {form.tagline === '' ? null : <span class="text-xs opacity-80">{form.tagline}</span>}
  </div>
)

const textField = (
  id: string,
  label: string,
  value: string,
  placeholder: string,
  onValue: (next: string) => void,
): JSX.Element => (
  <div class="flex flex-col gap-1">
    <label for={id}>{label}</label>
    <input
      class="input w-full"
      id={id}
      onInput={(e) => {
        if (e.currentTarget instanceof HTMLInputElement) {
          onValue(e.currentTarget.value)
        }
      }}
      placeholder={placeholder}
      type="text"
      value={value}
    />
  </div>
)

const swatches = (
  copy: DashCopy['designer'],
  form: DesignerForm,
  onField: CardDesignerViewProps['onField'],
): JSX.Element => (
  <div class="flex flex-col gap-2">
    <span>{copy.colorLabel}</span>
    <div class="flex flex-wrap items-center gap-2">
      {BRAND_SWATCHES.map((swatch): JSX.Element => (
        <button
          aria-label={swatch}
          aria-pressed={form.brandColor.toUpperCase() === swatch}
          class={cn('dash-swatch', form.brandColor.toUpperCase() === swatch && 'dash-swatch-selected')}
          key={swatch}
          onClick={() => {
            onField('brandColor', swatch)
          }}
          style={{ background: swatch }}
          type="button"
        />
      ))}
      <input
        aria-label={copy.colorHexLabel}
        class="input w-28 font-mono"
        onInput={(e) => {
          if (e.currentTarget instanceof HTMLInputElement) {
            onField('brandColor', e.currentTarget.value)
          }
        }}
        type="text"
        value={form.brandColor}
      />
    </div>
  </div>
)

export const CardDesignerView = ({
  busy,
  copy,
  failure,
  form,
  locationDenied,
  onField,
  onLockScreen,
  onSubmit,
  status,
}: CardDesignerViewProps): JSX.Element => (
  <section class="flex max-w-2xl flex-col gap-5">
    <div>
      <h1 class="text-2xl font-bold">{copy.title}</h1>
      <p class="opacity-70">{copy.description}</p>
    </div>

    <div class="flex flex-col gap-2">
      <span class="text-xs tracking-widest uppercase opacity-70">{copy.preview}</span>
      {preview(copy, form)}
    </div>

    {failure === null ? null : (
      <p role="alert" class="alert alert-error">
        {copy.failures[failure]}
      </p>
    )}

    <form
      class="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <div class="flex flex-col gap-1">
        <label for="handle">{copy.handleLabel}</label>
        <div class="flex items-center gap-2">
          <span class="opacity-70">{copy.handlePrefix}</span>
          <input
            class="input min-w-0 flex-1"
            id="handle"
            onInput={(e) => {
              if (e.currentTarget instanceof HTMLInputElement) {
                onField('handle', e.currentTarget.value)
              }
            }}
            placeholder={copy.handlePlaceholder}
            type="text"
            value={form.handle}
          />
        </div>
        {statusLabel(copy, status) === null ? null : (
          <span class="text-sm opacity-70">{statusLabel(copy, status)}</span>
        )}
      </div>

      {textField('venue-name', copy.nameLabel, form.name, copy.namePlaceholder, (next) => {
        onField('name', next)
      })}
      {textField('card-title', copy.titleLabel, form.title, '', (next) => {
        onField('title', next)
      })}
      {textField('tagline', copy.taglineLabel, form.tagline, copy.taglinePlaceholder, (next) => {
        onField('tagline', next)
      })}

      {swatches(copy, form, onField)}

      <div class="flex flex-col gap-1">
        <label for="category">{copy.categoryLabel}</label>
        <select
          class="select w-full"
          id="category"
          onChange={(e) => {
            if (e.currentTarget instanceof HTMLSelectElement) {
              const next: CardCategory = e.currentTarget.value === 'ticket' ? 'ticket' : 'membership'
              onField('category', next)
            }
          }}
          value={form.category}
        >
          <option value="membership">{copy.membership}</option>
          <option value="ticket">{copy.ticket}</option>
        </select>
      </div>

      {textField('perk', copy.perkLabel, form.perk, copy.perkPlaceholder, (next) => {
        onField('perk', next)
      })}
      {textField('reward', copy.rewardLabel, form.reward, copy.rewardPlaceholder, (next) => {
        onField('reward', next)
      })}

      <div class="flex flex-col gap-1">
        <label for="expiry">{copy.expiryLabel}</label>
        <select
          class="select w-full"
          id="expiry"
          onChange={(e) => {
            if (e.currentTarget instanceof HTMLSelectElement) {
              onField('validityDays', expiryFromValue(e.currentTarget.value))
            }
          }}
          value={form.validityDays === null ? '' : String(form.validityDays)}
        >
          {EXPIRY_CHOICES.map((days): JSX.Element => (
            <option key={String(days)} value={days === null ? '' : String(days)}>
              {expiryLabel(copy, days)}
            </option>
          ))}
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <label class="flex items-center gap-2" for="lock-screen">
          <input
            checked={form.lockScreen}
            id="lock-screen"
            onChange={(e) => {
              if (e.currentTarget instanceof HTMLInputElement) {
                onLockScreen(e.currentTarget.checked)
              }
            }}
            type="checkbox"
          />
          <span>{copy.lockScreenLabel}</span>
        </label>
        <span class="text-sm opacity-70">
          {locationDenied ? copy.locationUnavailable : copy.lockScreenHint}
        </span>
      </div>

      <button class="btn btn-primary" disabled={!canSubmit(form, status, busy)} type="submit">
        {busy ? copy.submitting : copy.submit}
      </button>
    </form>
  </section>
)

export interface CardDesignerProps {
  busy: boolean
  copy: DashCopy['designer']
  failure: CreateFailure | null
  onCheckHandle: (handle: string) => Promise<'available' | 'taken' | 'unknown'>
  onSubmit: (form: DesignerForm) => void
}

const GEOLOCATION_OPTIONS = { enableHighAccuracy: false, timeout: 8000 }

export const CardDesigner = ({
  busy,
  copy,
  failure,
  onCheckHandle,
  onSubmit,
}: CardDesignerProps): JSX.Element => {
  const [form, setForm] = useState<DesignerForm>(EMPTY_FORM)
  const [status, setStatus] = useState<HandleStatus>('idle')
  const [locationDenied, setLocationDenied] = useState(false)

  const onField = useCallback(<K extends keyof DesignerForm>(key: K, value: DesignerForm[K]): void => {
    setForm((current) => ({ ...current, [key]: value }))
  }, [])

  // The local rule decides first; only a well-formed, unreserved handle is
  // worth an api round trip, and that one is debounced.
  const { handle } = form
  useEffect(() => {
    const local = handleStatusOf(handle)
    setStatus(local)
    if (local !== 'checking') {
      return
    }
    const timer = setTimeout((): void => {
      const check = async (): Promise<void> => {
        const result = await onCheckHandle(handle)
        setStatus((current) => (current === 'checking' ? result : current))
      }
      void check()
    }, 300)
    return () => {
      clearTimeout(timer)
    }
  }, [handle, onCheckHandle])

  const onLockScreen = (on: boolean): void => {
    if (!on) {
      setForm((current) => ({ ...current, lockScreen: false, venue: null }))
      return
    }
    setLocationDenied(false)
    globalThis.navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((current) => ({
          ...current,
          lockScreen: true,
          venue: { lat: position.coords.latitude, lng: position.coords.longitude },
        }))
      },
      () => {
        setLocationDenied(true)
        setForm((current) => ({ ...current, lockScreen: false, venue: null }))
      },
      GEOLOCATION_OPTIONS,
    )
  }

  return (
    <CardDesignerView
      busy={busy}
      copy={copy}
      failure={failure}
      form={form}
      locationDenied={locationDenied}
      onField={onField}
      onLockScreen={onLockScreen}
      onSubmit={() => {
        onSubmit(form)
      }}
      status={status}
    />
  )
}
