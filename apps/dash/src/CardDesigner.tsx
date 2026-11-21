import { brandTextColor, CARD_DESCRIPTION_MAX_LENGTH, CARD_IDENTITIES } from '@fuda/sdk'
import type { CardCategory, CardIdentity, CardRecord, IssuerView } from '@fuda/sdk'
import { cn } from 'cn'
import type { JSX } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

import {
  canSubmit,
  requirementErrors,
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
  ExpiryChoice,
  FieldStatus,
  ValidityMode,
  WindowField,
} from './card-designer.ts'
import { assetUrlForDisplay } from './config.ts'
import type { DashCopy } from './copy.ts'
import { FieldLabel } from './FieldLabel.tsx'
import { isPlainClick } from './plain-click.ts'
import { PreviewQr } from './PreviewQr.tsx'

const identityOf = (raw: string): CardIdentity => CARD_IDENTITIES.find((row) => row === raw) ?? 'none'

export interface CardDesignerViewProps {
  artworkUrl?: string | null
  requirementRegistries?: readonly string[]
  busy: boolean
  editing?: boolean
  readonlySlugHint?: string
  copy: DashCopy['designer']
  failure: CreateFailure | null
  form: DesignerForm
  locationDenied: boolean
  savedLogoUrl: string | null
  onCategory: (category: CardCategory) => void
  onIdentity: (identity: CardIdentity) => void
  onRecord: (record: CardRecord) => void
  onAttendance: (enabled: boolean) => void
  onEditProfile: () => void
  onField: <K extends keyof DesignerForm>(key: K, value: DesignerForm[K]) => void
  onLockScreen: (on: boolean) => void
  onSlug: (slug: string) => void
  onSubmit: () => void
  onTitle: (title: string) => void
  onValidityDays: (days: ExpiryChoice) => void
  onValidityMode: (mode: ValidityMode) => void
  onWindow: (field: WindowField, value: string) => void
  // The card link's verdict; the venue's handle is settled before a card exists.
  slugStatus: FieldStatus
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

const labelled = (id: string, label: string, control: JSX.Element): JSX.Element => (
  <div class="flex flex-col gap-1">
    <label for={id}>{label}</label>
    {control}
  </div>
)

// One optional instant. `datetime-local` shows the operator's own wall clock
// and carries no timezone; `card-designer.ts` converts it through the local
// `Date`, so an empty field means the end is unbounded.
const datetimeField = (
  id: string,
  label: string,
  value: string,
  onValue: (next: string) => void,
): JSX.Element =>
  labelled(
    id,
    label,
    <input
      class="input w-full"
      id={id}
      onInput={(e) => {
        onValue(e.currentTarget.value)
      }}
      type="datetime-local"
      step="1"
      value={value}
    />,
  )

// The same two rules the schema checks, said in the operator's words; the
// submit stays disabled while one of them holds.
const windowAlert = (props: CardDesignerViewProps): JSX.Element => {
  const problem = windowProblemOf(props.form)
  return (
    <>
      {problem === null ? null : (
        <p class="text-error text-sm" role="alert">
          {props.copy.windowProblems[problem]}
        </p>
      )}
    </>
  )
}

const claimSection = (props: CardDesignerViewProps): JSX.Element => (
  <fieldset class="fieldset border-base-300 rounded-box border p-4">
    <legend class="fieldset-legend px-1 font-semibold">{props.copy.claimLabel}</legend>
    <div class="grid gap-3 sm:grid-cols-2">
      {datetimeField('claim-from', props.copy.claimFromLabel, props.form.claimFrom, (next) => {
        props.onWindow('claimFrom', next)
      })}
      {datetimeField('claim-until', props.copy.claimUntilLabel, props.form.claimUntil, (next) => {
        props.onWindow('claimUntil', next)
      })}
    </div>
    <p class="mt-2 text-sm opacity-70">{props.copy.claimHint}</p>
  </fieldset>
)

const validityDaysField = (props: CardDesignerViewProps): JSX.Element => {
  const current = props.form.validityDays
  const offList =
    current !== null && !EXPIRY_DAY_CHOICES.some((choice) => choice === current) ? current : null
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
        {offList === null ? null : (
          <option value={String(offList)}>{expiryLabel(props.copy, offList)}</option>
        )}
        {EXPIRY_DAY_CHOICES.map((days) => (
          <option key={days} value={String(days)}>
            {expiryLabel(props.copy, days)}
          </option>
        ))}
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
        {VALIDITY_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {validityModeLabel(props.copy, mode)}
          </option>
        ))}
      </select>
    </div>
    {props.form.validityMode === 'days' ? validityDaysField(props) : null}
    {props.form.validityMode === 'fixed' ? (
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        {datetimeField('valid-from', props.copy.validFromLabel, props.form.validFrom, (next) => {
          props.onWindow('validFrom', next)
        })}
        {datetimeField('valid-until', props.copy.validUntilLabel, props.form.validUntil, (next) => {
          props.onWindow('validUntil', next)
        })}
      </div>
    ) : null}
    <p class="mt-2 text-sm opacity-70">{props.copy.validityHint}</p>
  </fieldset>
)

const statusLabel = (labels: DashCopy['designer']['slugStatus'], status: FieldStatus): string | null =>
  status === 'idle' ? null : labels[status]

const preview = (props: CardDesignerViewProps): JSX.Element => (
  <div
    class="dash-card-preview"
    data-artwork={props.artworkUrl === null || props.artworkUrl === undefined ? undefined : ''}
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
    {props.artworkUrl === null || props.artworkUrl === undefined ? null : (
      <img
        alt=""
        class="aspect-[375/144] w-full rounded-lg object-cover"
        src={assetUrlForDisplay(props.artworkUrl)}
      />
    )}
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
  label: string,
  value: string,
  placeholder: string,
  onValue: (next: string) => void,
): JSX.Element =>
  labelled(
    id,
    label,
    <input
      class="input w-full"
      id={id}
      onInput={(e) => {
        onValue(e.currentTarget.value)
      }}
      placeholder={placeholder}
      type="text"
      value={value}
    />,
  )

// A name typed under a fixed prefix, with the rule's verdict under it.
const prefixedField = (field: {
  id: string
  label: string
  prefix: string
  value: string
  placeholder: string
  hint: { status: FieldStatus; text: string | null }
  onValue: (next: string) => void
  readOnly: boolean
}): JSX.Element => (
  <div class="flex flex-col gap-1">
    <label for={field.id}>{field.label}</label>
    <div class="flex items-center gap-2">
      <span>{field.prefix}</span>
      <input
        class="input min-w-0 flex-1"
        id={field.id}
        onInput={(e) => {
          field.onValue(e.currentTarget.value)
        }}
        placeholder={field.placeholder}
        type="text"
        readOnly={field.readOnly}
        value={field.value}
      />
    </div>
    {field.hint.text === null ? null : (
      <span
        class={cn(
          'text-sm',
          field.hint.status === 'available' || field.hint.status === 'checking'
            ? 'text-moderate'
            : 'text-danger',
        )}
      >
        {field.hint.text}
      </span>
    )}
  </div>
)

const RequirementFields = (
  props: Pick<CardDesignerViewProps, 'form' | 'copy' | 'requirementRegistries' | 'onField'>,
): JSX.Element => {
  const [touched, setTouched] = useState<string[]>([])
  const invalid = (field: string): boolean =>
    touched.includes(field) && requirementErrors(props.form).includes(field)
  return (
    <fieldset id="requirement-fields" class="fieldset rounded-box border-base-300 border p-4">
      <legend class="fieldset-legend">{props.copy.requirementLabel}</legend>
      <label for="requirement-registry">{props.copy.requirementRegistry}</label>
      <select
        id="requirement-registry"
        onBlur={() => {
          setTouched((current) => [...current, 'registry'])
        }}
        class="select w-full"
        value={props.form.requirement.registry}
        onInput={(event) => {
          props.onField('requirement', {
            ...props.form.requirement,
            registry: event.currentTarget.value,
          })
        }}
      >
        <option value="">{props.copy.requirementRegistryError}</option>
        {props.requirementRegistries?.map((registry) => (
          <option key={registry} value={registry}>
            {registry}
          </option>
        ))}
      </select>
      {invalid('registry') ? (
        <p role="alert" class="text-error">
          {props.copy.requirementRegistryError}
        </p>
      ) : null}
      {(['assetId', 'termsId'] as const).map((field) => (
        <div key={field} class="flex flex-col gap-1">
          <label for={`requirement-${field}`}>
            {field === 'assetId' ? props.copy.requirementAsset : props.copy.requirementTerms}
          </label>
          <input
            id={`requirement-${field}`}
            name={field}
            autoCapitalize="none"
            autoCorrect="off"
            spellcheck={false}
            onBlur={() => {
              setTouched((current) => [...current, field])
            }}
            class="input w-full font-mono"
            value={props.form.requirement[field]}
            aria-invalid={invalid(field)}
            aria-describedby={invalid(field) ? `requirement-${field}-error` : undefined}
            onInput={(event) => {
              props.onField('requirement', {
                ...props.form.requirement,
                [field]: event.currentTarget.value,
              })
            }}
          />
          {invalid(field) ? (
            <p id={`requirement-${field}-error`} role="alert" class="text-error">
              {props.copy.requirementHexError}
            </p>
          ) : null}
        </div>
      ))}
      <p>{props.copy.requirementFixed}</p>
    </fieldset>
  )
}

const identityHint = (props: CardDesignerViewProps): string => {
  if (props.form.identity === 'address') {
    return props.copy.identityAddressHint
  }
  if (props.form.requirementEnabled) {
    return props.copy.identityWalletHint
  }
  return props.form.identity === 'sensitive' ? props.copy.identitySensitiveHint : props.copy.identityHint
}

const RequirementIdentityFields = (props: CardDesignerViewProps): JSX.Element => (
  <>
    {!(props.editing ?? false) && (props.requirementRegistries?.length ?? 0) > 0 ? (
      <section class="flex min-w-0 flex-col gap-3">
        <label class="flex items-center gap-2" for="requirement-enabled">
          <input
            id="requirement-enabled"
            type="checkbox"
            class="toggle"
            aria-controls="requirement-fields"
            aria-expanded={props.form.requirementEnabled}
            checked={props.form.requirementEnabled}
            onInput={(event) => {
              props.onField('requirementEnabled', event.currentTarget.checked)
            }}
          />
          <span>{props.copy.requirementLabel}</span>
        </label>
        {props.form.requirementEnabled ? <RequirementFields {...props} /> : null}
      </section>
    ) : null}

    <div class="flex flex-col gap-1">
      <label for="identity">{props.copy.identityLabel}</label>
      <select
        class="select w-full"
        disabled={(props.editing ?? false) || props.form.record === 'onchain'}
        id="identity"
        onInput={(e) => {
          props.onIdentity(identityOf(e.currentTarget.value))
        }}
        value={props.form.identity}
      >
        <option value="none">
          {props.form.requirementEnabled ? props.copy.identityWallet : props.copy.identityNone}
        </option>
        {props.form.requirementEnabled || ((props.editing ?? false) && props.form.identity === 'address') ? (
          <option value="address">{props.copy.identityAddress}</option>
        ) : (
          <>
            <option value="passkey">{props.copy.identityPasskey}</option>
            <option value="sensitive">{props.copy.identitySensitive}</option>
          </>
        )}
      </select>
      <p class="text-moderate text-sm">{identityHint(props)}</p>
    </div>
  </>
)

export const CardDesignerView = (props: CardDesignerViewProps): JSX.Element => {
  const editing = props.editing ?? false
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
              if (!isPlainClick(event)) {
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
          {textField('card-title', props.copy.titleLabel, props.form.title, '', (next) => {
            props.onTitle(next)
          })}
          {prefixedField({
            hint: {
              status: props.slugStatus,
              text: editing ? null : statusLabel(props.copy.slugStatus, props.slugStatus),
            },
            id: 'card-slug',
            label: props.copy.slugLabel,
            onValue: (next) => {
              props.onSlug(next)
            },
            placeholder: props.copy.slugPlaceholder,
            prefix: `${props.copy.handlePrefix}${props.form.handle}/`,
            readOnly: editing,
            value: props.form.slug,
          })}
          {editing && props.readonlySlugHint !== undefined ? (
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
              disabled={editing || props.form.requirementEnabled}
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

          {props.form.record === 'onchain' ? (
            <div class="flex flex-col gap-1">
              <label class="flex items-center gap-2" for="attendance">
                <input
                  checked={props.form.attendance}
                  class="toggle"
                  id="attendance"
                  onInput={(e) => {
                    props.onAttendance(e.currentTarget.checked)
                  }}
                  type="checkbox"
                />
                <span>{props.copy.attendanceLabel}</span>
              </label>
              <span class="text-sm opacity-70">{props.copy.attendanceHint}</span>
            </div>
          ) : null}

          <RequirementIdentityFields {...props} />
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
            disabled={!canSubmit(props.form, props.slugStatus, props.busy, editing)}
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
  artworkUrl?: string | null
  requirementRegistries?: readonly string[]
  busy: boolean
  editing?: boolean
  readonlySlugHint?: string
  copy: DashCopy['designer']
  failure: CreateFailure | null
  initialDraft?: DesignerForm | null
  // The venue this operator already runs, when there is one.
  issuer: IssuerView | null
  onCheckSlug: NameCheck
  onDraftChange?: (form: DesignerForm) => void
  onEditProfile: (form: DesignerForm) => void
  onSubmit: (form: DesignerForm) => void
}

const GEOLOCATION_OPTIONS = { enableHighAccuracy: false, timeout: 8000 }
const CHECK_DELAY_MS = 300

type StatusSetter = (update: (current: FieldStatus) => FieldStatus) => void

// The local rule decides first; only a well-formed, unreserved name is worth an
// api round trip, and that one is debounced. The returned cleanup also drops an
// answer that arrives after the name changed or the designer closed.
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
  let stale = false
  const run = async (): Promise<void> => {
    const result = await check(value)
    if (!stale) {
      setStatus((current) => (current === 'checking' ? result : current))
    }
  }

  const timer = setTimeout((): void => {
    void run()
  }, CHECK_DELAY_MS)
  return () => {
    stale = true
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

const useDesignerDraft = (
  initialDraft: DesignerForm | null | undefined,
  publish: ((draft: DesignerForm) => void) | undefined,
) => {
  const [draft, setDraft] = useState<DesignerForm>(initialDraft ?? EMPTY_FORM)
  const latestDraft = useRef(draft)
  const mounted = useRef(true)
  const onDraftChange = useRef(publish)
  onDraftChange.current = publish
  // Publish in the same event that changes a field, not in an effect: a passive
  // effect runs after paint, and a trip to the profile can unmount this screen
  // before then, losing the last keystroke. Reading the previous draft from the
  // ref keeps two changes in one event from overwriting each other.
  const setForm = (change: (current: DesignerForm) => DesignerForm): void => {
    // A location answer can arrive after this screen left, and must not replace
    // whatever draft the operator has started since.
    if (!mounted.current) {
      return
    }
    const next = change(latestDraft.current)
    if (next === latestDraft.current) {
      return
    }
    latestDraft.current = next
    setDraft(next)
    onDraftChange.current?.(next)
  }
  // The opening draft is published too, so a screen opened and left unedited
  // still leaves its draft in place of an older session's.
  useLayoutEffect(() => {
    mounted.current = true
    onDraftChange.current?.(latestDraft.current)
    return () => {
      mounted.current = false
    }
  }, [])
  return { draft, latestDraft, setForm }
}

export const CardDesigner = (props: CardDesignerProps): JSX.Element => {
  const editing = props.editing ?? false
  const { draft, latestDraft, setForm } = useDesignerDraft(props.initialDraft, props.onDraftChange)
  const form = withIssuer(draft, props.issuer)
  const [slugStatus, setSlugStatus] = useState<FieldStatus>('idle')
  const [locationDenied, setLocationDenied] = useState(false)

  const onField = <K extends keyof DesignerForm>(key: K, value: DesignerForm[K]): void => {
    setForm((current) => {
      if (key === 'requirementEnabled') {
        return {
          ...current,
          identity: 'none',
          record: value === true ? 'offchain' : current.record,
          requirement:
            value === true
              ? {
                  ...EMPTY_FORM.requirement,
                  registry:
                    props.requirementRegistries?.length === 1 ? (props.requirementRegistries[0] ?? '') : '',
                }
              : EMPTY_FORM.requirement,
          requirementEnabled: value === true,
        }
      }
      return { ...current, [key]: value }
    })
  }

  useEffect(() => {
    if (editing) {
      setSlugStatus('available')
      return
    }
    return scheduleCheck(
      (update) => {
        setSlugStatus(update)
      },
      slugStatusOf(form.slug),
      form.slug,
      props.onCheckSlug,
    )
  }, [editing, form.slug])

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
      requirementRegistries={props.requirementRegistries}
      busy={props.busy}
      editing={editing}
      readonlySlugHint={props.readonlySlugHint}
      copy={props.copy}
      failure={props.failure}
      form={form}
      locationDenied={locationDenied}
      artworkUrl={props.artworkUrl}
      savedLogoUrl={props.issuer?.logoUrl ?? null}
      onField={onField}
      onAttendance={(attendance) => {
        setForm((current) => ({ ...current, attendance, attendanceEdited: true }))
      }}
      onIdentity={(identity) => {
        setForm((current) => ({
          ...current,
          identity,
          record: identity === 'none' ? current.record : 'offchain',
          requirement: {
            ...current.requirement,
            registry:
              current.requirement.registry ||
              (props.requirementRegistries?.length === 1 ? (props.requirementRegistries[0] ?? '') : ''),
          },
        }))
      }}
      onRecord={(record) => {
        setForm((current) => ({
          ...current,
          identity: record === 'onchain' ? 'none' : current.identity,
          record,
        }))
      }}
      onEditProfile={() => {
        // Read the ref: an input in this same tick has not rendered yet.
        props.onEditProfile(withIssuer(latestDraft.current, props.issuer))
      }}
      onCategory={(next) => {
        setForm((current) => withCategory(current, next))
      }}
      onLockScreen={onLockScreen}
      onSlug={(next) => {
        setForm((current) => withSlug(current, next))
      }}
      onSubmit={() => {
        props.onSubmit(withIssuer(latestDraft.current, props.issuer))
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
      slugStatus={slugStatus}
    />
  )
}
