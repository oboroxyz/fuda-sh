import type { IssuerUpdateRequest, IssuerView } from '@fuda/sdk'
import type { ComponentChild, JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { handleStatusOf } from './card-designer.ts'
import type { CreateFailure, FieldStatus } from './card-designer.ts'
import type { DashCopy } from './copy.ts'
import { browserImageTools, EMPTY_LOGO, generateLogoSet, withLogoResult } from './logo.ts'
import type { LogoSet, LogoState } from './logo.ts'
import { LogoField } from './LogoField.tsx'
import { isPlainClick } from './plain-click.ts'
import type { DashRoute } from './router.ts'
import { EMPTY_VENUE_FORM, venueBodyFrom } from './venue.ts'
import type { VenueForm } from './venue.ts'
import { VenueDetailsForm } from './VenueDetailsForm.tsx'
import { VenueIdentityFields } from './VenueIdentityFields.tsx'

export interface VenuePageProps {
  busy: boolean
  copy: DashCopy
  ens: JSX.Element | null
  // The account's passkeys, on a venue an account owns.
  passkeys?: ComponentChild
  failure: CreateFailure | null
  issuer: IssuerView | null
  publicUrl: string | null
  onCheckHandle: (handle: string) => Promise<'available' | 'taken' | 'unknown'>
  hasCardDraft?: boolean
  onCommitLogo: (logo: LogoSet) => Promise<boolean>
  onCreate: (form: VenueForm) => void
  onNavigate: (route: DashRoute) => void
  onUpdate: (body: IssuerUpdateRequest) => Promise<boolean>
}

export const VenuePage = (props: VenuePageProps): JSX.Element => {
  const [form, setForm] = useState<VenueForm>(EMPTY_VENUE_FORM)
  const [status, setStatus] = useState<FieldStatus>('idle')
  const [logo, setLogo] = useState<LogoState>(EMPTY_LOGO)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  // Guards for work that outlives a render: a newer logo choice, a newer handle
  // edit or an unmount makes the older result stale.
  const checkRevision = useRef(0)
  const logoRevision = useRef(0)
  const logoWorking = useRef(false)
  const startLogoWork = (): void => {
    logoWorking.current = true
    setLogoBusy(true)
  }
  const endLogoWork = (): void => {
    logoWorking.current = false
    setLogoBusy(false)
  }

  useEffect(
    () => () => {
      logoRevision.current += 1
    },
    [],
  )

  const previewUrl = logo.pick?.previewUrl
  useEffect(
    () => () => {
      if (previewUrl !== undefined) {
        URL.revokeObjectURL(previewUrl)
      }
    },
    [previewUrl],
  )

  useEffect(() => {
    const local = handleStatusOf(form.handle)
    setStatus(local)
    checkRevision.current += 1
    const revision = checkRevision.current
    if (local !== 'checking') {
      return
    }
    const run = async (): Promise<void> => {
      const next = await props.onCheckHandle(form.handle)
      if (checkRevision.current === revision) {
        setStatus(next)
      }
    }

    const timer = setTimeout(() => {
      void run()
    }, 300)
    return () => {
      clearTimeout(timer)
      checkRevision.current += 1
    }
  }, [form.handle])

  const pickLogo = (file: File): void => {
    logoRevision.current += 1
    const revision = logoRevision.current
    startLogoWork()
    setLogoFailed(false)
    const run = async (): Promise<void> => {
      const result = await generateLogoSet(file, browserImageTools)
      if (revision !== logoRevision.current) {
        return
      }
      setLogo(withLogoResult(result, (blob) => URL.createObjectURL(blob)))
      endLogoWork()
    }
    void run()
  }

  const clearLogo = (): void => {
    logoRevision.current += 1
    setLogo(EMPTY_LOGO)
    setLogoFailed(false)
  }

  const saveVenue = async (body: IssuerUpdateRequest): Promise<boolean> => {
    if (logoWorking.current) {
      return false
    }
    const { pick } = logo
    if (pick !== null) {
      const revision = logoRevision.current
      startLogoWork()
      setLogoFailed(false)
      const ok = await props.onCommitLogo(pick.variants).catch(() => false)
      if (revision !== logoRevision.current) {
        return false
      }
      endLogoWork()
      if (!ok) {
        setLogoFailed(true)
        return false
      }
      clearLogo()
    }
    return await props.onUpdate(body)
  }

  const profile = (issuer: IssuerView): JSX.Element => {
    const logoField = (
      <section aria-label={props.copy.logo.label} class="flex flex-col gap-3">
        <LogoField
          busy={logoBusy}
          copy={props.copy.logo}
          id="change-logo"
          label={props.copy.logo.label}
          onClear={clearLogo}
          onPick={pickLogo}
          savedUrl={issuer.logoUrl}
          state={logo}
        />
        {logoFailed ? <p class="text-error text-sm">{props.copy.logo.updateFailed}</p> : null}
      </section>
    )
    const ens = (
      <>
        {props.ens ?? (
          <p class="text-sm opacity-70" role="status">
            {props.copy.venue.ensUnavailable}
          </p>
        )}
      </>
    )
    const logoProps = { busy: logoBusy, field: logoField, pending: logo.pick !== null }
    return (
      <section class="dash-page flex max-w-3xl flex-col gap-6">
        <header class="dash-page-header">
          <h1 class="dash-page-title">{props.copy.venue.profileTitle}</h1>
          <p class="opacity-70">{props.copy.venue.profileDescription}</p>
        </header>
        <VenueDetailsForm
          // One profile form per venue: switching venues starts a fresh draft.
          key={issuer.id}
          copy={props.copy}
          ens={ens}
          issuer={issuer}
          publicUrl={props.publicUrl}
          onUpdate={saveVenue}
          logo={logoProps}
        />
        {props.passkeys}
        <div class="dash-actions">
          <a
            class="btn"
            href="/cards"
            onClick={(event) => {
              if (!isPlainClick(event)) {
                return
              }
              event.preventDefault()
              props.onNavigate('/cards')
            }}
          >
            {props.copy.nav.card}
          </a>
          {props.hasCardDraft === true ? null : (
            <a class="btn" href="/cards/new">
              {props.copy.published.addCard}
            </a>
          )}
        </div>
      </section>
    )
  }

  const update = <K extends keyof VenueForm>(key: K, value: VenueForm[K]): void => {
    setForm((current) => ({ ...current, [key]: value }))
  }
  const register = (): JSX.Element => (
    <section class="dash-page flex max-w-2xl flex-col gap-6">
      <header class="dash-page-header">
        <h1 class="dash-page-title">{props.copy.venue.registerTitle}</h1>
        <p class="opacity-70">{props.copy.venue.registerDescription}</p>
      </header>
      {props.failure === null ? null : (
        <p class="alert alert-error">{props.copy.designer.failures[props.failure]}</p>
      )}
      <form
        class="card flex flex-col gap-5 px-6 py-8"
        onSubmit={(event) => {
          event.preventDefault()
          if (!props.busy && status !== 'taken' && venueBodyFrom(form) !== null) {
            props.onCreate(form)
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

  return props.issuer === null ? register() : profile(props.issuer)
}
