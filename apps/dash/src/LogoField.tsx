/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

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

export const LogoField = ({
  busy,
  copy,
  id,
  label,
  onClear,
  onPick,
  savedUrl,
  state,
}: LogoFieldProps): JSX.Element => {
  const previewUrl = state.pick?.previewUrl ?? savedUrl
  return (
    <div class="flex min-w-0 flex-col gap-2">
      <label for={id}>{label}</label>
      <input
        accept={SOURCE_ACCEPT}
        aria-label={copy.choose}
        class="file-input w-full min-w-0"
        disabled={busy}
        id={id}
        onChange={(e) => {
          if (!(e.currentTarget instanceof HTMLInputElement)) {
            return
          }
          const file = e.currentTarget.files?.[0]
          // Permit choosing the same source again after a rejection or removal.
          e.currentTarget.value = ''
          if (file !== undefined) {
            onPick(file)
          }
        }}
        type="file"
      />
      <span class="text-sm opacity-70">{busy ? copy.updating : copy.hint}</span>
      {state.rejection === null ? null : (
        <p class="text-error text-sm" role="alert">
          {copy.rejections[state.rejection]}
        </p>
      )}
      {previewUrl === null || previewUrl === undefined ? null : (
        <div class="mt-2 flex flex-col items-start gap-2">
          <img alt={copy.previewAlt} class="dash-logo-preview" src={assetUrlForDisplay(previewUrl)} />
          {onClear === null || state.pick === null ? null : (
            <button class="btn btn-ghost btn-sm" disabled={busy} onClick={onClear} type="button">
              {copy.remove}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
