/** @jsxImportSource hono/jsx/dom */
import { brandTextColor, CARD_DESCRIPTION_MAX_LENGTH } from '@fuda/sdk'
import type { CardCategory, IssuerView } from '@fuda/sdk'
import { cn } from 'cn'
import { useCallback, useEffect, useLayoutEffect, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import {
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
import { assetUrlForDisplay } from './config.ts'
import type { DashCopy } from './copy.ts'
import { FieldLabel } from './FieldLabel.tsx'
import { browserLogoTools, EMPTY_LOGO, generateLogoSet, withLogoResult } from './logo.ts'
import type { LogoSet, LogoState } from './logo.ts'

export interface CardDesignerViewProps {
  busy: boolean
  editing?: boolean
  readonlySlugHint?: string
  copy: DashCopy['designer']
  failure: CreateFailure | null
  form: DesignerForm
  locationDenied: boolean
  logo: LogoState
  logoCopy: DashCopy['logo']
  savedLogoUrl: string | null
  // 'card' adds one more card to a venue that already exists, so its fields
  // are not asked for again.
  mode: DesignerMode
  onCategory: (category: CardCategory) => void
  onEditProfile: () => void
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
      step="1"
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
      {form.validityDays !== null && !EXPIRY_DAY_CHOICES.some((days) => days === form.validityDays) ? (
        <option value={String(form.validityDays)}>{expiryLabel(copy, form.validityDays)}</option>
      ) : null}
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

// A crossed-out illustration with no encoded payload.
const PreviewQr = (): JSX.Element => (
  <svg aria-hidden="true" class="size-24 shrink-0 rounded-lg bg-white" viewBox="0 0 96 96" fill="none">
    <g stroke="#a3a3a3" stroke-width="5">
      <path d="M14 14h22v22H14z M60 14h22v22H60z M14 60h22v22H14z" />
      <path d="M60 60h8v8h14v14H60z M46 14v14 M14 46h14 M46 68v14 M76 46h6" />
    </g>
    <path d="M12 12l72 72" stroke="white" stroke-width="12" />
    <path d="M12 12l72 72" stroke="#737373" stroke-width="4" stroke-linecap="round" />
  </svg>
)

const preview = (copy: DashCopy['designer'], form: DesignerForm, logoUrl: string | null): JSX.Element => (
  <div
    class="dash-card-preview"
    style={{ background: form.brandColor, color: brandTextColor(form.brandColor) }}
  >
    <div class="dash-card-preview-top">
      <div class="flex min-w-0 items-center gap-3">
        {logoUrl === null ? null : (
          <img
            alt=""
            class="size-10 shrink-0 rounded-xl object-contain"
            height={40}
            src={assetUrlForDisplay(logoUrl)}
            width={40}
          />
        )}
        <span>{form.name === '' ? copy.namePlaceholder : form.name}</span>
      </div>
    </div>
    <div class="flex items-end justify-between gap-4">
      <div class="flex min-w-0 flex-col gap-2">
        <strong>{form.title}</strong>
        {form.tagline === '' ? null : <span class="text-sm">{form.tagline}</span>}
        <span class="font-mono text-sm tracking-wide">ABCD-E123-F5679</span>
      </div>
      <PreviewQr />
    </div>
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
  hint: { status: FieldStatus; text: string | null },
  onValue: (next: string) => void,
  readOnly = false,
): JSX.Element => (
  <div class="flex flex-col gap-1">
    <label for={id}>{label}</label>
    <div class="flex items-center gap-2">
      <span>{prefix}</span>
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
        readOnly={readOnly}
        value={value}
      />
    </div>
    {hint.text === null ? null : (
      <span
        class={cn(
          'text-sm',
          hint.status === 'available' || hint.status === 'checking' ? 'text-moderate' : 'text-danger',
        )}
      >
        {hint.text}
      </span>
    )}
  </div>
)

export const CardDesignerView = ({
  busy,
  editing = false,
  readonlySlugHint,
  copy,
  failure,
  form,
  locationDenied,
  logo: _logo,
  logoCopy: _logoCopy,
  savedLogoUrl,
  mode,
  onCategory,
  onEditProfile,
  onField,
  onLockScreen,
  onLogoClear: _onLogoClear,
  onLogoPick: _onLogoPick,
  onSlug,
  onSubmit,
  onTitle,
  onValidityDays,
  onValidityMode,
  onWindow,
  status,
}: CardDesignerViewProps): JSX.Element => (
  <section class="flex max-w-2xl flex-col gap-6">
    <header class="dash-page-header">
      <h1 class="dash-page-title">{copy.title}</h1>
      <p class="opacity-70">{copy.description}</p>
    </header>

    <div class="flex flex-col gap-2">
      <span class="text-xs tracking-widest uppercase opacity-70">{copy.preview}</span>
      {preview(copy, form, savedLogoUrl)}
      <p class="text-moderate text-sm">
        {copy.profileHint}{' '}
        <a
          class="link"
          href="/profile"
          onClick={(event) => {
            if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
              return
            }
            event.preventDefault()
            onEditProfile()
          }}
        >
          {copy.editProfile}
        </a>
      </p>
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
      <fieldset disabled={busy} class="flex min-w-0 flex-col gap-4">
        {textField('card-title', copy.titleLabel, form.title, '', onTitle)}
        {prefixedField(
          'card-slug',
          copy.slugLabel,
          `${copy.handlePrefix}${form.handle}/`,
          form.slug,
          copy.slugPlaceholder,
          { status: status.slug, text: editing ? null : statusLabel(copy.slugStatus, status.slug) },
          onSlug,
          editing,
        )}
        {editing && readonlySlugHint !== undefined ? (
          <p class="text-moderate text-sm">{readonlySlugHint}</p>
        ) : null}

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

        <div class="flex flex-col gap-1">
          <label for="card-description">
            <FieldLabel label={copy.cardDescriptionLabel} optional={copy.optional} />
          </label>
          <textarea
            class="textarea w-full"
            id="card-description"
            maxLength={CARD_DESCRIPTION_MAX_LENGTH}
            onInput={(event) => {
              if (event.currentTarget instanceof HTMLTextAreaElement) {
                onField('description', event.currentTarget.value)
              }
            }}
            placeholder={copy.cardDescriptionPlaceholder}
            rows={4}
            value={form.description}
          />
          <p class="text-moderate text-sm">{copy.cardDescriptionHint}</p>
        </div>

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

        <button
          class="btn btn-primary self-start"
          disabled={!canSubmit(mode, form, status, busy, editing)}
          type="submit"
        >
          {busy ? copy.submitting : copy.submit}
        </button>
      </fieldset>
    </form>
  </section>
)

export type NameCheck = (value: string) => Promise<'available' | 'taken' | 'unknown'>

export interface CardDesignerProps {
  busy: boolean
  editing?: boolean
  readonlySlugHint?: string
  copy: DashCopy['designer']
  failure: CreateFailure | null
  initialDraft?: DesignerForm | null
  logoCopy: DashCopy['logo']
  // The venue this operator already runs, when there is one.
  issuer: IssuerView | null
  onCheckHandle: NameCheck
  onCheckSlug: NameCheck
  onDraftChange?: (form: DesignerForm) => void
  onEditProfile: (form: DesignerForm) => void
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

const withIssuer = (form: DesignerForm, issuer: IssuerView | null): DesignerForm =>
  issuer === null
    ? form
    : {
        ...form,
        brandColor: issuer.brandColor,
        handle: issuer.handle,
        name: issuer.name,
        tagline: issuer.tagline,
      }

export const CardDesigner = ({
  busy,
  editing = false,
  readonlySlugHint,
  copy,
  failure,
  initialDraft,
  issuer,
  logoCopy,
  onCheckHandle,
  onCheckSlug,
  onDraftChange,
  onEditProfile,
  onSubmit,
}: CardDesignerProps): JSX.Element => {
  const mode: DesignerMode = 'card'
  const [draft, setForm] = useState<DesignerForm>(() => initialDraft ?? EMPTY_FORM)
  const form = withIssuer(draft, issuer)
  // Publish before leaving the screen; a queued passive effect could restore
  // the previous session's draft after sign-out or successful card creation.
  useLayoutEffect(() => {
    onDraftChange?.(draft)
  }, [draft, onDraftChange])
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

  useEffect(() => {
    if (editing) {
      setSlugStatus('available')
      return
    }
    return scheduleCheck(setSlugStatus, slugStatusOf(slug), slug, onCheckSlug)
  }, [editing, onCheckSlug, slug])

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
      editing={editing}
      readonlySlugHint={readonlySlugHint}
      copy={copy}
      failure={failure}
      form={form}
      locationDenied={locationDenied}
      logo={logo}
      logoCopy={logoCopy}
      savedLogoUrl={issuer?.logoUrl ?? null}
      mode={mode}
      onField={onField}
      onEditProfile={() => {
        onEditProfile(form)
      }}
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
