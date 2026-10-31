import type { IssuerUpdateRequest, IssuerView } from '@fuda/sdk'
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js'
import type { JSX } from 'solid-js'

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
  const [form, setForm] = createSignal<VenueForm>(EMPTY_VENUE_FORM)
  const [status, setStatus] = createSignal<FieldStatus>('idle')
  const [logo, setLogo] = createSignal<LogoState>(EMPTY_LOGO)
  const [logoBusy, setLogoBusy] = createSignal(false)
  const [logoFailed, setLogoFailed] = createSignal(false)
  let checkRevision = 0
  let logoRevision = 0

  onCleanup(() => {
    logoRevision += 1
  })

  createEffect(() => {
    const previewUrl = logo().pick?.previewUrl
    onCleanup(() => {
      if (previewUrl !== undefined) {
        URL.revokeObjectURL(previewUrl)
      }
    })
  })

  createEffect(
    on(
      () => form().handle,
      (handle) => {
        const local = handleStatusOf(handle)
        setStatus(local)
        checkRevision += 1
        const revision = checkRevision
        if (local !== 'checking') {
          return
        }
        const timer = setTimeout(() => {
          const run = async (): Promise<void> => {
            const next = await props.onCheckHandle(handle)
            if (checkRevision === revision) {
              setStatus(next)
            }
          }
          void run()
        }, 300)
        onCleanup(() => {
          clearTimeout(timer)
        })
      },
    ),
  )

  const pickLogo = (file: File): void => {
    logoRevision += 1
    const revision = logoRevision
    setLogoBusy(true)
    setLogoFailed(false)
    const run = async (): Promise<void> => {
      const result = await generateLogoSet(file, browserLogoTools)
      if (revision !== logoRevision) {
        return
      }
      setLogo(withLogoResult(result, (blob) => URL.createObjectURL(blob)))
      setLogoBusy(false)
    }
    void run()
  }

  const clearLogo = (): void => {
    logoRevision += 1
    setLogo(EMPTY_LOGO)
    setLogoFailed(false)
  }

  const saveVenue = async (body: IssuerUpdateRequest): Promise<boolean> => {
    if (logoBusy()) {
      return false
    }
    const { pick } = logo()
    if (pick !== null) {
      const revision = logoRevision
      setLogoBusy(true)
      setLogoFailed(false)
      const ok = await props.onCommitLogo(pick.variants).catch(() => false)
      if (revision !== logoRevision) {
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

  // One profile form per venue: switching venues starts a fresh draft.
  const issuerId = createMemo(() => props.issuer?.id ?? null)

  const profile = (issuer: () => IssuerView): JSX.Element => {
    // Built once so the file input keeps its state while the form re-renders.
    const logoField = (
      <section aria-label={props.copy.logo.label} class="flex flex-col gap-3">
        <LogoField
          busy={logoBusy()}
          copy={props.copy.logo}
          id="change-logo"
          label={props.copy.logo.label}
          onClear={clearLogo}
          onPick={pickLogo}
          savedUrl={issuer().logoUrl}
          state={logo()}
        />
        {logoFailed() ? <p class="text-error text-sm">{props.copy.logo.updateFailed}</p> : null}
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
    const logoProps = {
      get busy() {
        return logoBusy()
      },
      field: logoField,
      get pending() {
        return logo().pick !== null
      },
    }
    return (
      <section class="dash-page flex max-w-3xl flex-col gap-6">
        <header class="dash-page-header">
          <h1 class="dash-page-title">{props.copy.venue.profileTitle}</h1>
          <p class="opacity-70">{props.copy.venue.profileDescription}</p>
        </header>
        <VenueDetailsForm
          copy={props.copy}
          ens={ens}
          issuer={issuer()}
          publicUrl={props.publicUrl}
          onUpdate={saveVenue}
          logo={logoProps}
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
          if (!props.busy && status() !== 'taken' && venueBodyFrom(form()) !== null) {
            props.onCreate(form(), null)
          }
        }}
      >
        <VenueIdentityFields
          copy={props.copy}
          handleStatus={status()}
          onChange={update}
          registering
          value={form()}
        />
        <button
          class="btn btn-primary sm:self-start"
          disabled={props.busy || status() === 'taken' || venueBodyFrom(form()) === null}
          type="submit"
        >
          {props.busy ? props.copy.venue.registering : props.copy.venue.register}
        </button>
      </form>
    </section>
  )

  return (
    <Show when={issuerId()} keyed fallback={register()}>
      {(_id: string) => <Show when={props.issuer}>{(issuer) => profile(issuer)}</Show>}
    </Show>
  )
}
