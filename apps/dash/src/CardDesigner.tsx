import { brandTextColor, CARD_DESCRIPTION_MAX_LENGTH } from '@fuda/sdk'
import type { CardCategory, CardIdentity, CardRecord, IssuerView } from '@fuda/sdk'
import { cn } from 'cn'
import { createComputed, createEffect, createSignal, For, on, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import {
  canSubmit,
  EMPTY_FORM,
  EXPIRY_DAY_CHOICES,
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
  onIdentity: (identity: CardIdentity) => void
  onRecord: (record: CardRecord) => void
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

// The helpers below take accessors and read them only inside attributes and
// text, so each input is created once and keeps focus while the form changes.

// One optional instant. `datetime-local` shows the operator's own wall clock
// and carries no timezone; `card-designer.ts` converts it through the local
// `Date`, so an empty field means the end is unbounded.
const datetimeField = (
  id: string,
  label: () => string,
  value: () => string,
  onValue: (next: string) => void,
): JSX.Element => (
  <div class="flex flex-col gap-1">
    <label for={id}>{label()}</label>
    <input
      class="input w-full"
      id={id}
      onInput={(e) => {
        onValue(e.currentTarget.value)
      }}
      type="datetime-local"
      step="1"
      value={value()}
    />
  </div>
)

// The same two rules the schema checks, said in the operator's words; the
// submit stays disabled while one of them holds.
const windowAlert = (props: CardDesignerViewProps): JSX.Element => {
  const problem = (): ReturnType<typeof windowProblemOf> => windowProblemOf(props.form)
  return (
    <>
      {problem() === null ? null : (
        <p class="text-error text-sm" role="alert">
          {props.copy.windowProblems[problem() ?? 'claimOrder']}
        </p>
      )}
    </>
  )
}

const claimSection = (props: CardDesignerViewProps): JSX.Element => (
  <fieldset class="fieldset border-base-300 rounded-box border p-4">
    <legend class="fieldset-legend px-1 font-semibold">{props.copy.claimLabel}</legend>
    <div class="grid gap-3 sm:grid-cols-2">
      {datetimeField(
        'claim-from',
        () => props.copy.claimFromLabel,
        () => props.form.claimFrom,
        (next) => {
          props.onWindow('claimFrom', next)
        },
      )}
      {datetimeField(
        'claim-until',
        () => props.copy.claimUntilLabel,
        () => props.form.claimUntil,
        (next) => {
          props.onWindow('claimUntil', next)
        },
      )}
    </div>
    <p class="mt-2 text-sm opacity-70">{props.copy.claimHint}</p>
  </fieldset>
)

const validityDaysField = (props: CardDesignerViewProps): JSX.Element => {
  const offList = (): number | null => {
    const days = props.form.validityDays
    return days !== null && !EXPIRY_DAY_CHOICES.some((choice) => choice === days) ? days : null
  }
  return (
    <div class="flex flex-col gap-1">
      <label for="validity-days">{props.copy.validityDaysLabel}</label>
      <select
        class="select w-full"
        id="validity-days"
        onInput={(e) => {
          props.onValidityDays(expiryFromValue(e.currentTarget.value))
        }}
        value={props.form.validityDays === null ? '' : String(props.form.validityDays)}
      >
        {offList() === null ? null : (
          <option value={String(offList())}>{expiryLabel(props.copy, offList() ?? 0)}</option>
        )}
        <For each={EXPIRY_DAY_CHOICES}>
          {(days) => <option value={String(days)}>{expiryLabel(props.copy, days)}</option>}
        </For>
      </select>
    </div>
  )
}

const validitySection = (props: CardDesignerViewProps): JSX.Element => (
  <fieldset class="fieldset border-base-300 rounded-box border p-4">
    <legend class="fieldset-legend px-1 font-semibold">{props.copy.validityLabel}</legend>
    <div class="flex flex-col gap-1">
      <label for="validity-mode">{props.copy.validityModeLabel}</label>
      <select
        class="select w-full"
        id="validity-mode"
        onInput={(e) => {
          if (isValidityMode(e.currentTarget.value)) {
            props.onValidityMode(e.currentTarget.value)
          }
        }}
        value={props.form.validityMode}
      >
        <For each={VALIDITY_MODES}>
          {(mode) => <option value={mode}>{validityModeLabel(props.copy, mode)}</option>}
        </For>
      </select>
    </div>
    {props.form.validityMode === 'days' ? validityDaysField(props) : null}
    {props.form.validityMode === 'fixed' ? (
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        {datetimeField(
          'valid-from',
          () => props.copy.validFromLabel,
          () => props.form.validFrom,
          (next) => {
            props.onWindow('validFrom', next)
          },
        )}
        {datetimeField(
          'valid-until',
          () => props.copy.validUntilLabel,
          () => props.form.validUntil,
          (next) => {
            props.onWindow('validUntil', next)
          },
        )}
      </div>
    ) : null}
    <p class="mt-2 text-sm opacity-70">{props.copy.validityHint}</p>
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

const preview = (props: CardDesignerViewProps): JSX.Element => (
  <div
    class="dash-card-preview"
    style={{ background: props.form.brandColor, color: brandTextColor(props.form.brandColor) }}
  >
    <div class="dash-card-preview-top">
      <div class="flex min-w-0 items-center gap-3">
        {props.savedLogoUrl === null ? null : (
          <img
            alt=""
            class="size-10 shrink-0 rounded-xl object-contain"
            height={40}
            src={assetUrlForDisplay(props.savedLogoUrl)}
            width={40}
          />
        )}
        <span>{props.form.name === '' ? props.copy.namePlaceholder : props.form.name}</span>
      </div>
    </div>
    <div class="flex items-end justify-between gap-4">
      <div class="flex min-w-0 flex-col gap-2">
        <strong>{props.form.title}</strong>
        {props.form.tagline === '' ? null : <span class="text-sm">{props.form.tagline}</span>}
        <span class="font-mono text-sm tracking-wide">ABCD-E123-F5679</span>
      </div>
      <PreviewQr />
    </div>
  </div>
)

const textField = (
  id: string,
  label: () => string,
  value: () => string,
  placeholder: () => string,
  onValue: (next: string) => void,
): JSX.Element => (
  <div class="flex flex-col gap-1">
    <label for={id}>{label()}</label>
    <input
      class="input w-full"
      id={id}
      onInput={(e) => {
        onValue(e.currentTarget.value)
      }}
      placeholder={placeholder()}
      type="text"
      value={value()}
    />
  </div>
)

// A name typed under a fixed prefix, with the rule's verdict under it.
const prefixedField = (field: {
  id: string
  label: () => string
  prefix: () => string
  value: () => string
  placeholder: () => string
  hint: () => { status: FieldStatus; text: string | null }
  onValue: (next: string) => void
  readOnly: () => boolean
}): JSX.Element => (
  <div class="flex flex-col gap-1">
    <label for={field.id}>{field.label()}</label>
    <div class="flex items-center gap-2">
      <span>{field.prefix()}</span>
      <input
        class="input min-w-0 flex-1"
        id={field.id}
        onInput={(e) => {
          field.onValue(e.currentTarget.value)
        }}
        placeholder={field.placeholder()}
        type="text"
        readOnly={field.readOnly()}
        value={field.value()}
      />
    </div>
    {field.hint().text === null ? null : (
      <span
        class={cn(
          'text-sm',
          field.hint().status === 'available' || field.hint().status === 'checking'
            ? 'text-moderate'
            : 'text-danger',
        )}
      >
        {field.hint().text}
      </span>
    )}
  </div>
)

export const CardDesignerView = (props: CardDesignerViewProps): JSX.Element => {
  const editing = (): boolean => props.editing ?? false
  return (
    <section class="flex max-w-2xl flex-col gap-6">
      <header class="dash-page-header">
        <h1 class="dash-page-title">{props.copy.title}</h1>
        <p class="opacity-70">{props.copy.description}</p>
      </header>

      <div class="flex flex-col gap-2">
        <span class="text-xs tracking-widest uppercase opacity-70">{props.copy.preview}</span>
        {preview(props)}
        <p class="text-moderate text-sm">
          {props.copy.profileHint}{' '}
          <a
            class="link"
            href="/profile"
            onClick={(event) => {
              if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
                return
              }
              event.preventDefault()
              props.onEditProfile()
            }}
          >
            {props.copy.editProfile}
          </a>
        </p>
      </div>

      {props.failure === null ? null : (
        <p role="alert" class="alert alert-error">
          {props.copy.failures[props.failure]}
        </p>
      )}

      <form
        class="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          props.onSubmit()
        }}
      >
        <fieldset disabled={props.busy} class="flex min-w-0 flex-col gap-4">
          {textField(
            'card-title',
            () => props.copy.titleLabel,
            () => props.form.title,
            () => '',
            (next) => {
              props.onTitle(next)
            },
          )}
          {prefixedField({
            hint: () => ({
              status: props.status.slug,
              text: editing() ? null : statusLabel(props.copy.slugStatus, props.status.slug),
            }),
            id: 'card-slug',
            label: () => props.copy.slugLabel,
            onValue: (next) => {
              props.onSlug(next)
            },
            placeholder: () => props.copy.slugPlaceholder,
            prefix: () => `${props.copy.handlePrefix}${props.form.handle}/`,
            readOnly: editing,
            value: () => props.form.slug,
          })}
          {editing() && props.readonlySlugHint !== undefined ? (
            <p class="text-moderate text-sm">{props.readonlySlugHint}</p>
          ) : null}

          <div class="flex flex-col gap-1">
            <label for="category">{props.copy.categoryLabel}</label>
            <select
              class="select w-full"
              id="category"
              onInput={(e) => {
                props.onCategory(e.currentTarget.value === 'ticket' ? 'ticket' : 'membership')
              }}
              value={props.form.category}
            >
              <option value="membership">{props.copy.membership}</option>
              <option value="ticket">{props.copy.ticket}</option>
            </select>
          </div>

          <div class="flex flex-col gap-1">
            <label for="record">{props.copy.recordLabel}</label>
            <select
              class="select w-full"
              disabled={editing()}
              id="record"
              onInput={(e) => {
                props.onRecord(e.currentTarget.value === 'onchain' ? 'onchain' : 'offchain')
              }}
              value={props.form.record}
            >
              <option value="offchain">{props.copy.recordOffchain}</option>
              <option value="onchain">{props.copy.recordOnchain}</option>
            </select>
            <p class="text-moderate text-sm">{props.copy.recordHint}</p>
          </div>

          <div class="flex flex-col gap-1">
            <label for="identity">{props.copy.identityLabel}</label>
            <select
              class="select w-full"
              disabled={editing() || props.form.record === 'onchain'}
              id="identity"
              onInput={(e) => {
                props.onIdentity(e.currentTarget.value === 'passkey' ? 'passkey' : 'none')
              }}
              value={props.form.identity}
            >
              <option value="none">{props.copy.identityNone}</option>
              <option value="passkey">{props.copy.identityPasskey}</option>
            </select>
            <p class="text-moderate text-sm">{props.copy.identityHint}</p>
          </div>

          <div class="flex flex-col gap-1">
            <label for="card-description">
              <FieldLabel label={props.copy.cardDescriptionLabel} optional={props.copy.optional} />
            </label>
            <textarea
              class="textarea w-full"
              id="card-description"
              maxLength={CARD_DESCRIPTION_MAX_LENGTH}
              onInput={(event) => {
                props.onField('description', event.currentTarget.value)
              }}
              placeholder={props.copy.cardDescriptionPlaceholder}
              rows={4}
              value={props.form.description}
            />
            <p class="text-moderate text-sm">{props.copy.cardDescriptionHint}</p>
          </div>

          {claimSection(props)}
          {validitySection(props)}

          {windowAlert(props)}

          <div class="flex flex-col gap-1">
            <label class="flex items-center gap-2" for="lock-screen">
              <input
                checked={props.form.lockScreen}
                id="lock-screen"
                onInput={(e) => {
                  props.onLockScreen(e.currentTarget.checked)
                }}
                type="checkbox"
              />
              <span>{props.copy.lockScreenLabel}</span>
            </label>
            <span class="text-sm opacity-70">
              {props.locationDenied ? props.copy.locationUnavailable : props.copy.lockScreenHint}
            </span>
          </div>

          <button
            class="btn btn-primary self-start"
            disabled={!canSubmit(props.mode, props.form, props.status, props.busy, editing())}
            type="submit"
          >
            {props.busy ? props.copy.submitting : props.copy.submit}
          </button>
        </fieldset>
      </form>
    </section>
  )
}

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

export const CardDesigner = (props: CardDesignerProps): JSX.Element => {
  const mode: DesignerMode = 'card'
  const editing = (): boolean => props.editing ?? false
  const [draft, setForm] = createSignal<DesignerForm>(props.initialDraft ?? EMPTY_FORM)
  const form = (): DesignerForm => withIssuer(draft(), props.issuer)
  // Publish synchronously with every change, so leaving the screen never loses
  // the latest draft or restores a previous session's.
  createComputed(() => {
    props.onDraftChange?.(draft())
  })
  const [handleStatus, setHandleStatus] = createSignal<FieldStatus>('idle')
  const [slugStatus, setSlugStatus] = createSignal<FieldStatus>('idle')
  const [locationDenied, setLocationDenied] = createSignal(false)
  // The picked logo waits here until submit: uploading on pick would stage an
  // upload that expires, or is never spent, every time the operator changes
  // their mind.
  const [logo, setLogo] = createSignal<LogoState>(EMPTY_LOGO)

  // The preview is an object URL, so each one is released when it is replaced
  // and when the designer goes away.
  createEffect(() => {
    const url = logo().pick?.previewUrl ?? null
    onCleanup(() => {
      if (url !== null) {
        URL.revokeObjectURL(url)
      }
    })
  })

  const onLogoPick = (file: File): void => {
    const run = async (): Promise<void> => {
      const result = await generateLogoSet(file, browserLogoTools)
      setLogo(withLogoResult(result, (blob) => URL.createObjectURL(blob)))
    }
    void run()
  }

  const onField = <K extends keyof DesignerForm>(key: K, value: DesignerForm[K]): void => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  // The designer adds a card to an existing venue, whose handle is settled.
  setHandleStatus('available')

  createEffect(
    on([editing, () => form().slug], ([isEditing, slug]) => {
      if (isEditing) {
        setSlugStatus('available')
        return
      }
      const stop = scheduleCheck(
        (update) => {
          setSlugStatus(update)
        },
        slugStatusOf(slug),
        slug,
        props.onCheckSlug,
      )
      onCleanup(() => {
        stop?.()
      })
    }),
  )

  const onLockScreen = (enabled: boolean): void => {
    if (!enabled) {
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
      busy={props.busy}
      editing={editing()}
      readonlySlugHint={props.readonlySlugHint}
      copy={props.copy}
      failure={props.failure}
      form={form()}
      locationDenied={locationDenied()}
      logo={logo()}
      logoCopy={props.logoCopy}
      savedLogoUrl={props.issuer?.logoUrl ?? null}
      mode={mode}
      onField={onField}
      onIdentity={(identity) => {
        setForm((current) => ({ ...current, identity }))
      }}
      onRecord={(record) => {
        setForm((current) => ({
          ...current,
          identity: record === 'onchain' ? 'none' : current.identity,
          record,
        }))
      }}
      onEditProfile={() => {
        props.onEditProfile(form())
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
        props.onSubmit(mode, form(), logo().pick?.variants ?? null)
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
      status={{ handle: handleStatus(), slug: slugStatus() }}
    />
  )
}
