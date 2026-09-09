/** @jsxImportSource hono/jsx/dom */
import { ISSUER_HANDLE_MAX_LENGTH } from '@fuda/sdk'
import { cn } from 'cn'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { FieldStatus } from './card-designer.ts'
import type { DashCopy } from './copy.ts'
import type { VenueForm } from './venue.ts'

type IdentityField = 'handle' | 'name' | 'tagline'

interface VenueIdentityFieldsProps {
  copy: DashCopy
  handleStatus?: FieldStatus
  onChange: (key: IdentityField, value: string) => void
  registering: boolean
  value: Pick<VenueForm, IdentityField>
}

export const VenueIdentityFields = ({
  copy,
  handleStatus = 'idle',
  onChange,
  registering,
  value,
}: VenueIdentityFieldsProps): JSX.Element => {
  const invalidHandle = handleStatus !== 'idle' && handleStatus !== 'available' && handleStatus !== 'checking'
  const field = (key: IdentityField, label: string, placeholder: string, maxLength: number): JSX.Element => (
    <label class="flex w-full flex-col gap-2">
      <span class="flex items-center gap-2">
        <span>{label}</span>
        {key === 'tagline' ? <span class="text-moderate text-xs">{copy.venue.optional}</span> : null}
      </span>
      <div class="flex min-w-0 items-center gap-2">
        {key === 'handle' ? <span class="shrink-0 text-sm">https://{copy.designer.handlePrefix}</span> : null}
        <input
          aria-invalid={key === 'handle' && invalidHandle ? 'true' : undefined}
          class="input w-full min-w-0"
          maxlength={maxLength}
          name={key}
          placeholder={placeholder}
          required={key !== 'tagline'}
          value={value[key]}
          onInput={(event) => {
            if (event.currentTarget instanceof HTMLInputElement) {
              onChange(key, event.currentTarget.value)
            }
          }}
        />
      </div>
      {key === 'handle' && handleStatus !== 'idle' ? (
        <span class={cn('text-sm', invalidHandle ? 'text-danger' : 'text-moderate')}>
          {copy.designer.handleStatus[handleStatus]}
        </span>
      ) : null}
      {key === 'handle' ? <span class="text-moderate text-sm">{copy.venue.handleHint}</span> : null}
    </label>
  )

  return (
    <>
      {registering
        ? field('handle', copy.venue.handleLabel, copy.designer.handlePlaceholder, ISSUER_HANDLE_MAX_LENGTH)
        : null}
      {field('name', copy.designer.nameLabel, copy.designer.namePlaceholder, 80)}
      {field('tagline', copy.designer.taglineLabel, copy.designer.taglinePlaceholder, 120)}
    </>
  )
}
