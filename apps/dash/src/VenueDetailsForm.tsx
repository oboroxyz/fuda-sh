import { brandTextColor } from '@fuda/sdk'
import type { IssuerUpdateRequest, IssuerView } from '@fuda/sdk'
import { cn } from 'cn'
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { BRAND_SWATCHES } from './brand-colors.ts'
import type { DashCopy } from './copy.ts'
import { venueUpdateBodyFrom } from './venue.ts'
import { VenueIdentityFields } from './VenueIdentityFields.tsx'
import { VenueLinkIcon } from './VenueLinkIcon.tsx'

interface VenueDetailsFormProps {
  copy: DashCopy
  ens: JSX.Element
  issuer: IssuerView
  logo: { field: JSX.Element; pending: boolean; busy: boolean }
  publicUrl: string | null
  onUpdate: (body: IssuerUpdateRequest) => Promise<boolean>
}

export const VenueDetailsForm = (props: VenueDetailsFormProps): JSX.Element => {
  const [draft, setDraft] = useState<IssuerUpdateRequest | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const saving = useRef(false)
  const revision = useRef(0)
  useEffect(() => {
    if (props.logo.pending) {
      setState((current) => (current === 'saved' ? 'idle' : current))
    }
  }, [props.logo.pending])
  useEffect(
    () => () => {
      revision.current += 1
    },
    [],
  )

  const saved: IssuerUpdateRequest = {
    brandColor: props.issuer.brandColor,
    name: props.issuer.name,
    tagline: props.issuer.tagline,
  }
  const form: IssuerUpdateRequest = draft ?? saved
  const body = venueUpdateBodyFrom(form)
  const changed =
    body !== null &&
    (props.logo.pending ||
      body.name !== props.issuer.name ||
      body.tagline !== props.issuer.tagline ||
      body.brandColor !== props.issuer.brandColor)
  const update = (key: keyof IssuerUpdateRequest, value: string): void => {
    setDraft((current) => ({ ...(current ?? saved), [key]: value }))
    setState('idle')
  }

  const submit = (): void => {
    const current = body
    if (current === null || !changed || props.logo.busy || saving.current) {
      return
    }
    saving.current = true
    setState('saving')
    const ticket = revision.current
    const run = async (): Promise<void> => {
      const ok = await props.onUpdate(current).catch(() => false)
      if (ticket !== revision.current) {
        return
      }
      saving.current = false
      if (ok) {
        setDraft(null)
      }
      setState(ok ? 'saved' : 'failed')
    }
    void run()
  }

  return (
    <form
      class="card flex flex-col gap-5 px-6 py-8"
      style={{ '--dash-logo-preview-background': form.brandColor }}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <header class="min-w-0 rounded-xl border border-[var(--fuda-border)] p-5 sm:p-6">
        <h2 class="mb-3 text-2xl leading-tight font-bold tracking-tight wrap-anywhere">
          {props.issuer.name}
        </h2>
        {props.publicUrl === null ? null : (
          <a
            class="link link-hover flex items-start gap-2 text-sm text-[var(--fuda-muted)]"
            href={props.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <VenueLinkIcon kind="globe" />
            <span class="min-w-0 wrap-anywhere">{props.publicUrl}</span>
          </a>
        )}
        {props.ens}
      </header>
      <fieldset class="flex flex-col gap-5" disabled={state === 'saving'}>
        <VenueIdentityFields
          copy={props.copy}
          onChange={(key, value) => {
            if (key !== 'handle') {
              update(key, value)
            }
          }}
          registering={false}
          value={{ ...form, handle: props.issuer.handle }}
        />
        <fieldset class="fieldset">
          <legend class="text-base font-normal">{props.copy.designer.colorLabel}</legend>
          <div class="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {BRAND_SWATCHES.map(({ color, name }) => (
              <button
                key={name}
                aria-label={`${props.copy.designer.colorNames[name]} ${color}`}
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
            <span>{props.copy.designer.customColorLabel}</span>
            <input
              aria-label={props.copy.designer.customColorLabel}
              class="h-11 w-16 cursor-pointer rounded-lg border border-[var(--fuda-border)] bg-white p-1"
              type="color"
              value={form.brandColor}
              onInput={(event) => {
                update('brandColor', event.currentTarget.value)
              }}
            />
          </label>
        </fieldset>
        {props.logo.field}
      </fieldset>
      {state === 'failed' ? (
        <p class="text-danger text-sm" role="alert">
          {props.copy.venue.saveFailed}
        </p>
      ) : null}
      {state === 'saved' ? (
        <p class="text-moderate text-sm" role="status">
          {props.copy.venue.saved}
        </p>
      ) : null}
      <button
        class="btn btn-primary sm:self-start"
        disabled={!changed || props.logo.busy || state === 'saving'}
        type="submit"
      >
        {state === 'saving' ? props.copy.venue.saving : props.copy.venue.save}
      </button>
    </form>
  )
}
