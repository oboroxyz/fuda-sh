/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'
import { SOURCE_ACCEPT } from './logo.ts'
import type { LogoState } from './logo.ts'

export interface LogoFieldProps {
  busy: boolean
  copy: DashCopy['logo']
  id: string
  // What the control is called here: the designer asks for a logo, the
  // published screen offers to change one.
  label: string
  // null where there is nothing to take back, as on the published screen, whose
  // mark is already live.
  onClear: (() => void) | null
  onPick: (file: File) => void
  state: LogoState
}

export const LogoField = ({ busy, copy, id, label, onClear, onPick, state }: LogoFieldProps): JSX.Element => (
  <div class="flex flex-col gap-2">
    <label for={id}>{label}</label>
    <div class="flex flex-wrap items-center gap-3">
      {state.pick === null ? null : (
        <figure class="flex flex-col gap-1">
          <img alt={copy.previewAlt} class="dash-logo-preview" src={state.pick.previewUrl} />
          <figcaption class="text-xs opacity-70">{copy.previewAlt}</figcaption>
        </figure>
      )}
      <input
        accept={SOURCE_ACCEPT}
        aria-label={copy.choose}
        class="file-input min-w-0 flex-1"
        disabled={busy}
        id={id}
        onChange={(e) => {
          if (!(e.currentTarget instanceof HTMLInputElement)) {
            return
          }
          const file = e.currentTarget.files?.[0]
          // The value is cleared so picking the same file twice — after a
          // rejection, say — still reaches this handler.
          e.currentTarget.value = ''
          if (file !== undefined) {
            onPick(file)
          }
        }}
        type="file"
      />
      {onClear === null || state.pick === null ? null : (
        <button class="btn btn-ghost btn-sm" disabled={busy} onClick={onClear} type="button">
          {copy.remove}
        </button>
      )}
    </div>
    <span class="text-sm opacity-70">{busy ? copy.updating : copy.hint}</span>
    {state.rejection === null ? null : (
      <p class="text-error text-sm" role="alert">
        {copy.rejections[state.rejection]}
      </p>
    )}
  </div>
)
