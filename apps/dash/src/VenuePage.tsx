/** @jsxImportSource hono/jsx/dom */
import type { IssuerUpdateRequest, IssuerView } from '@fuda/sdk'
import { useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { handleStatusOf } from './card-designer.ts'
import type { CreateFailure, FieldStatus } from './card-designer.ts'
import type { DashCopy } from './copy.ts'
import { browserLogoTools, EMPTY_LOGO, generateLogoSet, withLogoResult } from './logo.ts'
import type { LogoSet, LogoState } from './logo.ts'
import { LogoField } from './LogoField.tsx'
import type { DashRoute } from './router.ts'
import { EMPTY_VENUE_FORM, venueBodyFrom } from './venue.ts'
import type { VenueForm } from './venue.ts'
import { VenueDetailsForm } from './VenueDetailsForm.tsx'
import { VenueIdentityFields } from './VenueIdentityFields.tsx'

export interface VenuePageProps {
  busy: boolean
  canCreateCard: boolean
  copy: DashCopy
  ens: JSX.Element | null
  failure: CreateFailure | null
  issuer: IssuerView | null
  publicUrl: string | null
  onCheckHandle: (handle: string) => Promise<'available' | 'taken' | 'unknown'>
  hasCardDraft?: boolean
  onCommitLogo: (logo: LogoSet) => Promise<boolean>
  onCreate: (form: VenueForm, logo: LogoSet | null) => void
  onNavigate: (route: DashRoute) => void
  onUpdate: (body: IssuerUpdateRequest) => Promise<boolean>
}

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

  const saveVenue = async (body: IssuerUpdateRequest): Promise<boolean> => {
    if (logoBusy) {
      return false
    }
    if (logo.pick !== null) {
      const revision = logoRevision.current
      setLogoBusy(true)
      setLogoFailed(false)
      const ok = await props.onCommitLogo(logo.pick.variants).catch(() => false)
      if (revision !== logoRevision.current) {
        return false
      }
      setLogoBusy(false)
      if (!ok) {
        setLogoFailed(true)
        return false
      }
      clearLogo()
    }
    return await props.onUpdate(body)
  }

  if (props.issuer !== null) {
    return (
      <section class="dash-page flex max-w-3xl flex-col gap-6">
        <header class="dash-page-header">
          <h1 class="dash-page-title">{props.copy.venue.profileTitle}</h1>
          <p class="opacity-70">{props.copy.venue.profileDescription}</p>
        </header>
        <VenueDetailsForm
          key={props.issuer.id}
          copy={props.copy}
          ens={
            props.ens ?? (
              <p class="text-sm opacity-70" role="status">
                {props.copy.venue.ensUnavailable}
              </p>
            )
          }
          issuer={props.issuer}
          publicUrl={props.publicUrl}
          onUpdate={saveVenue}
          logo={{
            busy: logoBusy,
            field: (
              <section aria-label={props.copy.logo.label} class="flex flex-col gap-3">
                <LogoField
                  busy={logoBusy}
                  copy={props.copy.logo}
                  id="change-logo"
                  label={props.copy.logo.label}
                  onClear={clearLogo}
                  onPick={pickLogo}
                  savedUrl={props.issuer.logoUrl}
                  state={logo}
                />
                {logoFailed ? <p class="text-error text-sm">{props.copy.logo.updateFailed}</p> : null}
              </section>
            ),
            pending: logo.pick !== null,
          }}
        />
        <div class="dash-actions">
          <a
            class="btn"
            href="/cards"
            onClick={(event) => {
              if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
                return
              }
              event.preventDefault()
              props.onNavigate('/cards')
            }}
          >
            {props.copy.nav.card}
          </a>
          {props.hasCardDraft !== true &&
            (props.canCreateCard ? (
              <a class="btn" href="/cards/new">
                {props.copy.published.addCard}
              </a>
            ) : (
              <button class="btn" disabled type="button">
                {props.copy.published.addCard}
              </button>
            ))}
        </div>
      </section>
    )
  }

  const copy = props.copy.designer
  const update = <K extends keyof VenueForm>(key: K, value: VenueForm[K]): void => {
    setForm((current) => ({ ...current, [key]: value }))
  }
  return (
    <section class="dash-page flex max-w-2xl flex-col gap-6">
      <header class="dash-page-header">
        <h1 class="dash-page-title">{props.copy.venue.registerTitle}</h1>
        <p class="opacity-70">{props.copy.venue.registerDescription}</p>
      </header>
      {props.failure === null ? null : <p class="alert alert-error">{copy.failures[props.failure]}</p>}
      <form
        class="card flex flex-col gap-5 px-6 py-8"
        onSubmit={(event) => {
          event.preventDefault()
          if (!props.busy && status !== 'taken' && venueBodyFrom(form) !== null) {
            props.onCreate(form, null)
          }
        }}
      >
        <VenueIdentityFields
          copy={props.copy}
          handleStatus={status}
          onChange={update}
          registering
          value={form}
        />
        <button
          class="btn btn-primary sm:self-start"
          disabled={props.busy || status === 'taken' || venueBodyFrom(form) === null}
          type="submit"
        >
          {props.busy ? props.copy.venue.registering : props.copy.venue.register}
        </button>
      </form>
    </section>
  )
}
