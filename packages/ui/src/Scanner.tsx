import { Show, createSignal, onCleanup, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import { startCamera } from './camera.ts'
import { SCANNER_LABELS, SCANNER_READY } from './scanner.ts'
import type { ScannerLabels, ScannerProps } from './scanner.ts'

// Camera loop: a throttled decode of the video's frames, paused while the page
// is hidden and ended by the first code read. The paste box is always present
// so a device whose camera is denied or missing still works.
//
// `autoFocus` is for an unattended reader — a USB keyboard-wedge QR scanner
// types the payload and presses Enter, so the box has to already hold focus and
// take it back after a stray click. It is opt-in because the member app renders
// this same component on a phone, where focusing a text input raises the
// on-screen keyboard over the page.
//
// `cameraMode: 'off'` is for a reader-only station that has a USB scanner and
// should not ask for a camera at all, such as an iPad on a stand. A camera
// prompt or a warning badge above a paste box is the wrong thing to show a
// queue. This mode renders one waiting line instead: no camera, no field,
// nothing focused. The scan then arrives through
// the caller's own document-level listener, which must be wired before use.
export const Scanner = (props: ScannerProps): JSX.Element => {
  const labels = (): ScannerLabels => props.labels ?? SCANNER_LABELS
  const [camera, setCamera] = createSignal<'idle' | 'on' | 'done' | 'unavailable'>('idle')
  const [pasted, setPasted] = createSignal('')
  let video: HTMLVideoElement | undefined
  let box: HTMLInputElement | undefined

  onMount(() => {
    if (props.autoFocus === true) {
      box?.focus()
    }
    if (props.cameraMode === 'off' || video === undefined) {
      return
    }
    const cameraSession = startCamera({
      onCode: (text) => {
        props.onInput(text)
      },
      onState: (next) => {
        setCamera(next)
      },
      video,
    })
    onCleanup(cameraSession.release)
  })

  return (
    <Show
      when={props.cameraMode !== 'off'}
      fallback={
        <div class="flex min-h-[60vh] flex-col items-center justify-center p-8">
          <div class="text-center text-3xl font-semibold opacity-80">{labels().ready ?? SCANNER_READY}</div>
        </div>
      }
    >
      <div
        class="flex flex-col items-center gap-4 p-4"
        onClick={() => {
          if (props.autoFocus === true) {
            box?.focus()
          }
        }}
      >
        <Show
          when={camera() !== 'unavailable'}
          fallback={<div class="badge badge-warning">{labels().cameraUnavailable}</div>}
        >
          <Show when={camera() !== 'done'}>
            <video
              ref={(el) => {
                video = el
              }}
              class="rounded-box bg-base-300 w-full max-w-md"
              playsinline
              muted
            />
          </Show>
        </Show>
        <form
          class="join w-full max-w-md"
          onSubmit={(e) => {
            e.preventDefault()
            props.onInput(pasted())
          }}
        >
          <input
            ref={(el) => {
              box = el
            }}
            class="input join-item w-full"
            placeholder={labels().placeholder}
            aria-label={labels().placeholder}
            value={pasted()}
            onInput={(e) => {
              setPasted(e.currentTarget.value)
            }}
          />
          <button type="submit" class="btn btn-primary join-item">
            {labels().check}
          </button>
        </form>
      </div>
    </Show>
  )
}
