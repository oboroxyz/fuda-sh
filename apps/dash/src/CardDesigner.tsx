/** @jsxImportSource hono/jsx/dom */
import type { CardCategory, IssuerView } from '@fuda/sdk'
import { cn } from 'cn'
import { useCallback, useEffect, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import {
  BRAND_SWATCHES,
  canSubmit,
  EMPTY_FORM,
  EXPIRY_DAY_CHOICES,
  handleStatusOf,
  slugStatusOf,
  windowProblemOf,
  withCategory,
  withSlug,
  withTitle,
  withValidityDays,
  withValidityMode,
  withWindow,
} from './card-designer.ts'
import type {
  CreateFailure,
  DesignerForm,
  DesignerMode,
  DesignerStatus,
  ExpiryChoice,
  FieldStatus,
  ValidityMode,
  WindowField,
} from './card-designer.ts'
import type { DashCopy } from './copy.ts'
import { browserLogoTools, EMPTY_LOGO, generateLogoSet, withLogoResult } from './logo.ts'
import type { LogoSet, LogoState } from './logo.ts'
import { LogoField } from './LogoField.tsx'

export interface CardDesignerViewProps {
  busy: boolean
  copy: DashCopy['designer']
  failure: CreateFailure | null
  form: DesignerForm
  locationDenied: boolean
  logo: LogoState
  logoCopy: DashCopy['logo']
  // 'card' adds one more card to a venue that already exists, so its fields
  // are not asked for again.
  mode: DesignerMode
  onCategory: (category: CardCategory) => void
  onField: <K extends keyof DesignerForm>(key: K, value: DesignerForm[K]) => void
  onLockScreen: (on: boolean) => void
  onLogoClear: () => void
  onLogoPick: (file: File) => void
  onSlug: (slug: string) => void
  onSubmit: () => void
  onTitle: (title: string) => void
  onValidityDays: (days: ExpiryChoice) => void
  onValidityMode: (mode: ValidityMode) => void
  onWindow: (field: WindowField, value: string) => void
  status: DesignerStatus
}

const expiryLabel = (copy: DashCopy['designer'], days: number): string =>
  copy.expiryDays.replace('{days}', String(days))

// The select's values are the choices themselves, so an unexpected one — a
// stale DOM, a translated build — falls back to the shortest choice rather
// than putting a bad number in the body.
const expiryFromValue = (raw: string): ExpiryChoice =>
  EXPIRY_DAY_CHOICES.find((choice) => String(choice) === raw) ?? EXPIRY_DAY_CHOICES[0]

const VALIDITY_MODES: readonly ValidityMode[] = ['none', 'days', 'fixed']

const isValidityMode = (raw: string): raw is ValidityMode => VALIDITY_MODES.some((mode) => mode === raw)

const validityModeLabel = (copy: DashCopy['designer'], mode: ValidityMode): string => {
  if (mode === 'days') {
    return copy.validityDaysMode
  }
  return mode === 'fixed' ? copy.validityFixed : copy.validityNone
}

// One optional instant. `datetime-local` shows the operator's own wall clock
// and carries no timezone; `card-designer.ts` converts it through the local
// `Date`, so an empty field means the end is unbounded.
const datetimeField = (
  id: string,
  label: string,
  value: string,
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
      type="datetime-local"
      value={value}
    />
  </div>
)

// The same two rules the schema checks, said in the operator's words; the
// submit stays disabled while one of them holds.
const windowAlert = (copy: DashCopy['designer'], form: DesignerForm): JSX.Element | null => {
  const problem = windowProblemOf(form)
  return problem === null ? null : (
    <p class="text-error text-sm" role="alert">
      {copy.windowProblems[problem]}
    </p>
  )
}

const claimSection = (
  copy: DashCopy['designer'],
  form: DesignerForm,
  onWindow: CardDesignerViewProps['onWindow'],
): JSX.Element => (
  <fieldset class="fieldset border-base-300 rounded-box border p-4">
    <legend class="fieldset-legend px-1 font-semibold">{copy.claimLabel}</legend>
    <div class="grid gap-3 sm:grid-cols-2">
      {datetimeField('claim-from', copy.claimFromLabel, form.claimFrom, (next) => {
        onWindow('claimFrom', next)
      })}
      {datetimeField('claim-until', copy.claimUntilLabel, form.claimUntil, (next) => {
        onWindow('claimUntil', next)
      })}
    </div>
    <p class="mt-2 text-sm opacity-70">{copy.claimHint}</p>
  </fieldset>
)

const validityDaysField = (
  copy: DashCopy['designer'],
  form: DesignerForm,
  onValidityDays: CardDesignerViewProps['onValidityDays'],
): JSX.Element => (
  <div class="flex flex-col gap-1">
    <label for="validity-days">{copy.validityDaysLabel}</label>
    <select
      class="select w-full"
      id="validity-days"
      onChange={(e) => {
        if (e.currentTarget instanceof HTMLSelectElement) {
          onValidityDays(expiryFromValue(e.currentTarget.value))
        }
      }}
      value={form.validityDays === null ? '' : String(form.validityDays)}
    >
      {EXPIRY_DAY_CHOICES.map((days): JSX.Element => (
        <option key={String(days)} value={String(days)}>
          {expiryLabel(copy, days)}
        </option>
      ))}
    </select>
  </div>
)

const validitySection = (
  copy: DashCopy['designer'],
  form: DesignerForm,
  onValidityDays: CardDesignerViewProps['onValidityDays'],
  onValidityMode: CardDesignerViewProps['onValidityMode'],
  onWindow: CardDesignerViewProps['onWindow'],
): JSX.Element => (
  <fieldset class="fieldset border-base-300 rounded-box border p-4">
    <legend class="fieldset-legend px-1 font-semibold">{copy.validityLabel}</legend>
    <div class="flex flex-col gap-1">
      <label for="validity-mode">{copy.validityModeLabel}</label>
      <select
        class="select w-full"
        id="validity-mode"
        onChange={(e) => {
          if (e.currentTarget instanceof HTMLSelectElement && isValidityMode(e.currentTarget.value)) {
            onValidityMode(e.currentTarget.value)
          }
        }}
        value={form.validityMode}
      >
        {VALIDITY_MODES.map((mode): JSX.Element => (
          <option key={mode} value={mode}>
            {validityModeLabel(copy, mode)}
          </option>
        ))}
      </select>
    </div>
    {form.validityMode === 'days' ? validityDaysField(copy, form, onValidityDays) : null}
    {form.validityMode === 'fixed' ? (
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        {datetimeField('valid-from', copy.validFromLabel, form.validFrom, (next) => {
          onWindow('validFrom', next)
        })}
        {datetimeField('valid-until', copy.validUntilLabel, form.validUntil, (next) => {
          onWindow('validUntil', next)
        })}
      </div>
    ) : null}
    <p class="mt-2 text-sm opacity-70">{copy.validityHint}</p>
  </fieldset>
)

const statusLabel = (labels: DashCopy['designer']['handleStatus'], status: FieldStatus): string | null =>
  status === 'idle' ? null : labels[status]

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

// A name typed under a fixed prefix, with the rule's verdict under it.
const prefixedField = (
  id: string,
  label: string,
  prefix: string,
  value: string,
  placeholder: string,
  hint: string | null,
  onValue: (next: string) => void,
): JSX.Element => (
  <div class="flex flex-col gap-1">
    <label for={id}>{label}</label>
    <div class="flex items-center gap-2">
      <span class="opacity-70">{prefix}</span>
      <input
        class="input min-w-0 flex-1"
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
    {hint === null ? null : <span class="text-sm opacity-70">{hint}</span>}
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

// The venue's own fields, asked for only while the venue does not exist yet.
const venueFields = (
  copy: DashCopy['designer'],
  form: DesignerForm,
  status: FieldStatus,
  onField: CardDesignerViewProps['onField'],
): JSX.Element => (
  <div class="flex flex-col gap-4">
    {prefixedField(
      'handle',
      copy.handleLabel,
      copy.handlePrefix,
      form.handle,
      copy.handlePlaceholder,
      statusLabel(copy.handleStatus, status),
      (next) => {
        onField('handle', next)
      },
    )}
    {textField('venue-name', copy.nameLabel, form.name, copy.namePlaceholder, (next) => {
      onField('name', next)
    })}
    {textField('tagline', copy.taglineLabel, form.tagline, copy.taglinePlaceholder, (next) => {
      onField('tagline', next)
    })}
    {swatches(copy, form, onField)}
  </div>
)

export const CardDesignerView = ({
  busy,
  copy,
  failure,
  form,
  locationDenied,
  logo,
  logoCopy,
  mode,
  onCategory,
  onField,
  onLockScreen,
  onLogoClear,
  onLogoPick,
  onSlug,
  onSubmit,
  onTitle,
  onValidityDays,
  onValidityMode,
  onWindow,
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
      {mode === 'venue' ? venueFields(copy, form, status.handle, onField) : null}

      <LogoField
        busy={busy}
        copy={logoCopy}
        id="venue-logo"
        label={logoCopy.label}
        onClear={onLogoClear}
        onPick={onLogoPick}
        state={logo}
      />

      {textField('card-title', copy.titleLabel, form.title, '', onTitle)}
      {prefixedField(
        'card-slug',
        copy.slugLabel,
        `${copy.handlePrefix}${form.handle}/`,
        form.slug,
        copy.slugPlaceholder,
        statusLabel(copy.slugStatus, status.slug),
        onSlug,
      )}

      <div class="flex flex-col gap-1">
        <label for="category">{copy.categoryLabel}</label>
        <select
          class="select w-full"
          id="category"
          onChange={(e) => {
            if (e.currentTarget instanceof HTMLSelectElement) {
              onCategory(e.currentTarget.value === 'ticket' ? 'ticket' : 'membership')
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

      {claimSection(copy, form, onWindow)}
      {validitySection(copy, form, onValidityDays, onValidityMode, onWindow)}

      {windowAlert(copy, form)}

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

      <button class="btn btn-primary" disabled={!canSubmit(mode, form, status, busy)} type="submit">
        {busy ? copy.submitting : copy.submit}
      </button>
    </form>
  </section>
)

export type NameCheck = (value: string) => Promise<'available' | 'taken' | 'unknown'>

export interface CardDesignerProps {
  busy: boolean
  copy: DashCopy['designer']
  failure: CreateFailure | null
  logoCopy: DashCopy['logo']
  // The venue this operator already runs, when there is one.
  issuer: IssuerView | null
  onCheckHandle: NameCheck
  onCheckSlug: NameCheck
  onSubmit: (mode: DesignerMode, form: DesignerForm, logo: LogoSet | null) => void
}

const GEOLOCATION_OPTIONS = { enableHighAccuracy: false, timeout: 8000 }
const CHECK_DELAY_MS = 300

type StatusSetter = (update: (current: FieldStatus) => FieldStatus) => void

// The local rule decides first; only a well-formed, unreserved name is worth an
// api round trip, and that one is debounced.
const scheduleCheck = (
  setStatus: StatusSetter,
  local: FieldStatus,
  value: string,
  check: NameCheck,
): (() => void) | undefined => {
  setStatus(() => local)
  if (local !== 'checking') {
    return
  }
  const timer = setTimeout((): void => {
    const run = async (): Promise<void> => {
      const result = await check(value)
      setStatus((current) => (current === 'checking' ? result : current))
    }
    void run()
  }, CHECK_DELAY_MS)
  return () => {
    clearTimeout(timer)
  }
}

const initialForm = (issuer: IssuerView | null): DesignerForm =>
  issuer === null
    ? EMPTY_FORM
    : {
        ...EMPTY_FORM,
        brandColor: issuer.brandColor,
        handle: issuer.handle,
        name: issuer.name,
        tagline: issuer.tagline,
      }

export const CardDesigner = ({
  busy,
  copy,
  failure,
  issuer,
  logoCopy,
  onCheckHandle,
  onCheckSlug,
  onSubmit,
}: CardDesignerProps): JSX.Element => {
  const mode: DesignerMode = issuer === null ? 'venue' : 'card'
  const [form, setForm] = useState<DesignerForm>(() => initialForm(issuer))
  const [handleStatus, setHandleStatus] = useState<FieldStatus>('idle')
  const [slugStatus, setSlugStatus] = useState<FieldStatus>('idle')
  const [locationDenied, setLocationDenied] = useState(false)
  // The picked logo waits here until submit: uploading on pick would stage an
  // upload that expires, or is never spent, every time the operator changes
  // their mind.
  const [logo, setLogo] = useState<LogoState>(EMPTY_LOGO)

  // The preview is an object URL, so each one is released when it is replaced
  // and when the designer goes away.
  useEffect(() => {
    const url = logo.pick?.previewUrl ?? null
    return () => {
      if (url !== null) {
        URL.revokeObjectURL(url)
      }
    }
  }, [logo])

  const onLogoPick = (file: File): void => {
    const run = async (): Promise<void> => {
      const result = await generateLogoSet(file, browserLogoTools)
      setLogo(withLogoResult(result, (blob) => URL.createObjectURL(blob)))
    }
    void run()
  }

  const onField = useCallback(<K extends keyof DesignerForm>(key: K, value: DesignerForm[K]): void => {
    setForm((current) => ({ ...current, [key]: value }))
  }, [])

  const { handle, slug } = form
  useEffect(() => {
    // An existing venue's handle is settled; only a new one is checked.
    if (mode === 'card') {
      setHandleStatus('available')
      return
    }
    return scheduleCheck(setHandleStatus, handleStatusOf(handle), handle, onCheckHandle)
  }, [handle, mode, onCheckHandle])

  useEffect(() => scheduleCheck(setSlugStatus, slugStatusOf(slug), slug, onCheckSlug), [onCheckSlug, slug])

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
      logo={logo}
      logoCopy={logoCopy}
      mode={mode}
      onField={onField}
      onCategory={(next) => {
        setForm((current) => withCategory(current, next))
      }}
      onLockScreen={onLockScreen}
      onLogoClear={() => {
        setLogo(EMPTY_LOGO)
      }}
      onLogoPick={onLogoPick}
      onSlug={(next) => {
        setForm((current) => withSlug(current, next))
      }}
      onSubmit={() => {
        onSubmit(mode, form, logo.pick?.variants ?? null)
      }}
      onTitle={(next) => {
        setForm((current) => withTitle(current, next))
      }}
      onValidityDays={(next) => {
        setForm((current) => withValidityDays(current, next))
      }}
      onValidityMode={(next) => {
        setForm((current) => withValidityMode(current, next))
      }}
      onWindow={(field, next) => {
        setForm((current) => withWindow(current, field, next))
      }}
      status={{ handle: handleStatus, slug: slugStatus }}
    />
  )
}
