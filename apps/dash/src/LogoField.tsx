import type { JSX } from 'preact'

import { assetUrlForDisplay } from './config.ts'
import type { DashCopy } from './copy.ts'
import { SOURCE_ACCEPT } from './logo.ts'
import type { LogoState } from './logo.ts'

export interface LogoFieldProps {
  busy: boolean
  copy: DashCopy['logo']
  id: string
  label: string
  // Removing a pending replacement restores the saved mark; it does not delete it.
  onClear: (() => void) | null
  onPick: (file: File) => void
  savedUrl?: string | null
  state: LogoState
}

export const LogoField = (props: LogoFieldProps): JSX.Element => {
  const previewUrl = (): string | null | undefined => props.state.pick?.previewUrl ?? props.savedUrl
  return (
    <div class="flex min-w-0 flex-col gap-2">
      <label for={props.id}>{props.label}</label>
      <input
        accept={SOURCE_ACCEPT}
        aria-label={props.copy.choose}
        class="file-input w-full min-w-0"
        disabled={props.busy}
        id={props.id}
        onInput={(e) => {
          const file = e.currentTarget.files?.[0]
          // Permit choosing the same source again after a rejection or removal.
          e.currentTarget.value = ''
          if (file !== undefined) {
            props.onPick(file)
          }
        }}
        type="file"
      />
      <span class="text-sm opacity-70">{props.busy ? props.copy.updating : props.copy.hint}</span>
      {props.state.rejection === null ? null : (
        <p class="text-error text-sm" role="alert">
          {props.copy.rejections[props.state.rejection]}
        </p>
      )}
      {previewUrl() === null || previewUrl() === undefined ? null : (
        <div class="mt-2 flex flex-col items-start gap-2">
          <img
            alt={props.copy.previewAlt}
            class="dash-logo-preview"
            src={assetUrlForDisplay(previewUrl() ?? '')}
          />
          {props.onClear === null || props.state.pick === null ? null : (
            <button
              class="btn btn-ghost btn-sm"
              disabled={props.busy}
              onClick={() => {
                props.onClear?.()
              }}
              type="button"
            >
              {props.copy.remove}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
