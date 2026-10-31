import { ISSUER_HANDLE_MAX_LENGTH } from '@fuda/sdk'
import { cn } from 'cn'
import type { JSX } from 'solid-js'

import type { FieldStatus } from './card-designer.ts'
import type { DashCopy } from './copy.ts'
import { FieldLabel } from './FieldLabel.tsx'
import type { VenueForm } from './venue.ts'

type IdentityField = 'handle' | 'name' | 'tagline'

interface VenueIdentityFieldsProps {
  copy: DashCopy
  handleStatus?: FieldStatus
  onChange: (key: IdentityField, value: string) => void
  registering: boolean
  value: Pick<VenueForm, IdentityField>
}

export const VenueIdentityFields = (props: VenueIdentityFieldsProps): JSX.Element => {
  const handleStatus = (): FieldStatus => props.handleStatus ?? 'idle'
  const invalidHandle = (): boolean =>
    handleStatus() !== 'idle' && handleStatus() !== 'available' && handleStatus() !== 'checking'
  const statusText = (): string | null => {
    const status = handleStatus()
    return status === 'idle' ? null : props.copy.designer.handleStatus[status]
  }
  const field = (
    key: IdentityField,
    label: () => string,
    placeholder: () => string,
    maxLength: number,
  ): JSX.Element => (
    <label class="flex w-full flex-col gap-2">
      <FieldLabel label={label()} optional={key === 'tagline' ? props.copy.venue.optional : undefined} />
      <div class="flex min-w-0 items-center gap-2">
        {key === 'handle' ? (
          <span class="shrink-0 text-sm">https://{props.copy.designer.handlePrefix}</span>
        ) : null}
        <input
          aria-invalid={key === 'handle' && invalidHandle() ? 'true' : undefined}
          class="input w-full min-w-0"
          maxlength={maxLength}
          name={key}
          placeholder={placeholder()}
          required={key !== 'tagline'}
          value={props.value[key]}
          onInput={(event) => {
            props.onChange(key, event.currentTarget.value)
          }}
        />
      </div>
      {key === 'handle' && statusText() !== null ? (
        <span class={cn('text-sm', invalidHandle() ? 'text-danger' : 'text-moderate')}>{statusText()}</span>
      ) : null}
      {key === 'handle' ? <span class="text-moderate text-sm">{props.copy.venue.handleHint}</span> : null}
    </label>
  )

  return (
    <>
      {props.registering
        ? field(
            'handle',
            () => props.copy.venue.handleLabel,
            () => props.copy.designer.handlePlaceholder,
            ISSUER_HANDLE_MAX_LENGTH,
          )
        : null}
      {field(
        'name',
        () => props.copy.designer.nameLabel,
        () => props.copy.designer.namePlaceholder,
        80,
      )}
      {field(
        'tagline',
        () => props.copy.designer.taglineLabel,
        () => props.copy.designer.taglinePlaceholder,
        120,
      )}
    </>
  )
}
