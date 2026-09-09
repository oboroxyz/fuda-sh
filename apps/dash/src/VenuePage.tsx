/** @jsxImportSource hono/jsx/dom */
import { brandTextColor } from '@fuda/sdk'
import type { IssuerView } from '@fuda/sdk'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { BRAND_SWATCHES } from './brand-colors.ts'
import { handleStatusOf } from './card-designer.ts'
import type { CreateFailure, FieldStatus } from './card-designer.ts'
import type { DashCopy } from './copy.ts'
import { browserLogoTools, EMPTY_LOGO, generateLogoSet, withLogoResult } from './logo.ts'
import type { LogoSet, LogoState } from './logo.ts'
import { LogoField } from './LogoField.tsx'
import { StampSettings } from './StampSettings.tsx'
import type { StampSettingsProps } from './StampSettings.tsx'
import { EMPTY_VENUE_FORM, venueBodyFrom } from './venue.ts'
import type { VenueForm } from './venue.ts'

export interface VenuePageProps {
  busy: boolean
  canCreateCard: boolean
  copy: DashCopy
  ens: JSX.Element | null
  failure: CreateFailure | null
  issuer: IssuerView | null
  onCheckHandle: (handle: string) => Promise<'available' | 'taken' | 'unknown'>
  onCommitLogo: (logo: LogoSet) => Promise<boolean>
  onCreate: (form: VenueForm, logo: LogoSet | null) => void
  onNewCard: () => void
  publicUrl: string | null
  stampSettings: Pick<StampSettingsProps, 'load' | 'save'>
}

const statusText = (copy: DashCopy['designer'], status: FieldStatus): string | null =>
  status === 'idle' ? null : copy.handleStatus[status]

export const VenuePage = (props: VenuePageProps): JSX.Element => {
  const [form, setForm] = useState<VenueForm>(EMPTY_VENUE_FORM)
  const [status, setStatus] = useState<FieldStatus>('idle')
  const [logo, setLogo] = useState<LogoState>(EMPTY_LOGO)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  const checkRevision = useRef(0)
  const logoRevision = useRef(0)

  useEffect(
    () => () => {
      logoRevision.current += 1
    },
    [],
  )

  useEffect(() => {
    const previewUrl = logo.pick?.previewUrl
    return () => {
      if (previewUrl !== undefined) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [logo])

  useEffect(() => {
    const local = handleStatusOf(form.handle)
    setStatus(local)
    checkRevision.current += 1
    const revision = checkRevision.current
    if (local !== 'checking') {
      return
    }
    const timer = setTimeout(() => {
      const run = async (): Promise<void> => {
        const next = await props.onCheckHandle(form.handle)
        if (checkRevision.current === revision) {
          setStatus(next)
        }
      }
      void run()
    }, 300)
    return () => {
      clearTimeout(timer)
    }
  }, [form.handle])

  const pickLogo = (file: File): void => {
    logoRevision.current += 1
    const revision = logoRevision.current
    setLogoBusy(true)
    setLogoFailed(false)
    const run = async (): Promise<void> => {
      const result = await generateLogoSet(file, browserLogoTools)
      if (revision !== logoRevision.current) {
        return
      }
      setLogo(withLogoResult(result, (blob) => URL.createObjectURL(blob)))
      setLogoBusy(false)
    }
    void run()
  }

  const clearLogo = (): void => {
    logoRevision.current += 1
    setLogo(EMPTY_LOGO)
    setLogoFailed(false)
  }

  const uploadLogo = (): void => {
    if (logoBusy || logo.pick === null) {
      return
    }
    const { variants } = logo.pick
    const revision = logoRevision.current
    setLogoBusy(true)
    setLogoFailed(false)
    const run = async (): Promise<void> => {
      const ok = await props.onCommitLogo(variants).catch(() => false)
      if (revision !== logoRevision.current) {
        return
      }
      setLogoBusy(false)
      if (ok) {
        clearLogo()
      } else {
        setLogoFailed(true)
      }
    }
    void run()
  }

  if (props.issuer !== null) {
    return (
      <section class="dash-page max-w-3xl">
        <header class="dash-page-header">
          <p class="dash-eyebrow">{props.copy.nav.venue}</p>
          <h1 class="text-3xl font-bold">{props.issuer.name}</h1>
          <p class="text-sm opacity-70">{props.publicUrl}</p>
        </header>
        <div class="card grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-start">
          <div class="space-y-2">
            {props.issuer.logoUrl === null ? null : (
              <img
                alt={props.copy.logo.previewAlt}
                class="border-base-300 size-16 rounded-xl border object-cover"
                src={props.issuer.logoUrl}
              />
            )}
            <p>{props.issuer.tagline}</p>
            <div class="h-3 w-24 rounded-full" style={{ background: props.issuer.brandColor }} />
          </div>
          <div class="flex flex-col gap-3">
            <LogoField
              busy={logoBusy}
              copy={props.copy.logo}
              id="change-logo"
              label={props.copy.logo.change}
              onClear={clearLogo}
              onPick={pickLogo}
              state={logo}
            />
            {logo.pick === null ? null : (
              <button
                class="btn btn-primary self-start"
                disabled={logoBusy}
                onClick={uploadLogo}
                type="button"
              >
                {props.copy.logo.upload}
              </button>
            )}
          </div>
          {logoFailed ? <p class="text-error text-sm sm:col-span-2">{props.copy.logo.updateFailed}</p> : null}
        </div>
        {props.ens ?? (
          <div class="alert" role="status">
            {props.copy.venue.ensUnavailable}
          </div>
        )}
        <div class="dash-actions">
          <button
            class="btn btn-primary"
            disabled={!props.canCreateCard}
            onClick={props.onNewCard}
            type="button"
          >
            {props.copy.published.addCard}
          </button>
        </div>
        <StampSettings copy={props.copy.stamps} {...props.stampSettings} />
      </section>
    )
  }

  const copy = props.copy.designer
  const update = <K extends keyof VenueForm>(key: K, value: VenueForm[K]): void => {
    setForm((current) => ({ ...current, [key]: value }))
  }
  const input = (key: 'handle' | 'name' | 'tagline', label: string, placeholder: string): JSX.Element => (
    <label class="flex w-full flex-col gap-2">
      <span>{label}</span>
      <input
        class="input"
        value={form[key]}
        placeholder={placeholder}
        onInput={(event) => {
          if (event.currentTarget instanceof HTMLInputElement) {
            update(key, event.currentTarget.value)
          }
        }}
      />
      {key === 'handle' && statusText(copy, status) !== null ? (
        <span
          class={cn(
            'text-sm',
            status === 'available' || status === 'checking' ? 'text-moderate' : 'text-danger',
          )}
        >
          {statusText(copy, status)}
        </span>
      ) : null}
      {key === 'handle' ? <span class="text-sm opacity-70">{props.copy.venue.handleHint}</span> : null}
    </label>
  )
  return (
    <section class="dash-page max-w-2xl">
      <header class="dash-page-header">
        <p class="dash-eyebrow">{props.copy.nav.venue}</p>
        <h1 class="text-3xl font-bold">{props.copy.venue.registerTitle}</h1>
        <p class="opacity-70">{props.copy.venue.registerDescription}</p>
      </header>
      {props.failure === null ? null : <p class="alert alert-error">{copy.failures[props.failure]}</p>}
      <form
        class="card flex flex-col gap-5 p-5"
        onSubmit={(event) => {
          event.preventDefault()
          props.onCreate(form, logo.pick?.variants ?? null)
        }}
      >
        {input('handle', props.copy.venue.handleLabel, copy.handlePlaceholder)}
        {input('name', copy.nameLabel, copy.namePlaceholder)}
        {input('tagline', copy.taglineLabel, copy.taglinePlaceholder)}
        <fieldset class="fieldset">
          <legend class="text-base font-normal">{copy.colorLabel}</legend>
          <div class="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {BRAND_SWATCHES.map(({ color, name }): JSX.Element => (
              <button
                key={name}
                aria-label={`${copy.colorNames[name]} ${color}`}
                aria-pressed={form.brandColor.toUpperCase() === color ? 'true' : 'false'}
                class={cn('dash-swatch', form.brandColor.toUpperCase() === color && 'dash-swatch-selected')}
                style={{ background: color, color: brandTextColor(color) }}
                type="button"
                onClick={() => {
                  update('brandColor', color)
                }}
              >
                <span aria-hidden="true">Aa</span>
              </button>
            ))}
          </div>
          <label class="mt-2 flex items-center gap-3">
            <span>{copy.customColorLabel}</span>
            <input
              aria-label={copy.customColorLabel}
              class="h-11 w-16 cursor-pointer rounded-lg border border-[var(--fuda-border)] bg-white p-1"
              type="color"
              value={form.brandColor}
              onInput={(event) => {
                if (event.currentTarget instanceof HTMLInputElement) {
                  update('brandColor', event.currentTarget.value)
                }
              }}
            />
          </label>
        </fieldset>
        <LogoField
          busy={props.busy || logoBusy}
          copy={props.copy.logo}
          id="venue-logo"
          label={props.copy.logo.label}
          onClear={clearLogo}
          onPick={pickLogo}
          state={logo}
        />
        <button
          class="btn btn-primary sm:self-start"
          disabled={props.busy || logoBusy || status === 'taken' || venueBodyFrom(form) === null}
          type="submit"
        >
          {props.busy ? props.copy.venue.registering : props.copy.venue.register}
        </button>
      </form>
    </section>
  )
}
