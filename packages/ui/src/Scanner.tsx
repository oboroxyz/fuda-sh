import { Show, createSignal, onCleanup, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import { createFrameDecoder } from './barcode.ts'

export interface ScannerLabels {
  cameraUnavailable: string
  placeholder: string
  check: string
  ready?: string
}

// In `cameraMode: 'off'` this line is the whole screen, so it is stated as an
// instruction to the person presenting, not as a status.
const READY = 'present your pass'

const DEFAULT_LABELS: ScannerLabels = {
  cameraUnavailable: 'camera unavailable — paste below',
  check: 'Check',
  placeholder: 'paste fuda:v1:… or 0x…',
  ready: READY,
}

export interface ScannerProps {
  onInput: (text: string) => void
  labels?: ScannerLabels
  autoFocus?: boolean
  cameraMode?: 'auto' | 'off'
}

// One decode per tick is plenty for a QR held still, and a phone screen at a
// full 30 fps decode would heat an iPad for nothing.
const SCAN_INTERVAL_MS = 120
// A larger frame costs the JS decoder time without helping a code that fills a
// third of it.
const MAX_FRAME_SIDE = 960

// The camera loop starts once, on mount. Props are read when they are used, so
// a parent passing a fresh `onInput` never reopens the camera mid-scan.
const startCamera = (
  video: HTMLVideoElement,
  onCode: (text: string) => void,
  onState: (state: 'on' | 'done' | 'unavailable') => void,
): (() => void) => {
  const decodeFrame = createFrameDecoder()
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  let stream: MediaStream | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const lifetime = new AbortController()
  const release = (): void => {
    stopped = true
    clearTimeout(timer)
    lifetime.abort()
    for (const track of stream?.getTracks() ?? []) {
      track.stop()
    }
  }
  const schedule = (run: () => Promise<void>): void => {
    clearTimeout(timer)
    if (!stopped && !document.hidden) {
      timer = setTimeout(() => {
        void run()
      }, SCAN_INTERVAL_MS)
    }
  }
  const tick = async (): Promise<void> => {
    if (stopped || context === null) {
      return
    }
    try {
      if (video.videoWidth > 0) {
        const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight))
        canvas.width = Math.round(video.videoWidth * scale)
        canvas.height = Math.round(video.videoHeight * scale)
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        const text = await decodeFrame(context.getImageData(0, 0, canvas.width, canvas.height))
        if (stopped) {
          return
        }
        if (text !== null) {
          // The member app keeps this component on screen after a read; a lit
          // camera with nothing scanning would only drain the battery, and the
          // video would be left as a black frame above the result.
          release()
          onState('done')
          onCode(text)
          return
        }
      }
    } catch {
      // a frame that cannot be decoded is not an error
    }
    schedule(tick)
  }
  const onVisibility = (): void => {
    if (document.hidden) {
      clearTimeout(timer)
    } else {
      schedule(tick)
    }
  }
  const start = async (): Promise<void> => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      // A stream that arrives after cleanup would keep the camera lit forever.
      if (stopped) {
        for (const track of stream.getTracks()) {
          track.stop()
        }
        return
      }
      video.srcObject = stream
      await video.play()
      onState('on')
      schedule(tick)
    } catch {
      onState('unavailable')
    }
  }
  document.addEventListener('visibilitychange', onVisibility, { signal: lifetime.signal })
  void start()
  return release
}

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
  const labels = (): ScannerLabels => props.labels ?? DEFAULT_LABELS
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
    onCleanup(
      startCamera(
        video,
        (text) => {
          props.onInput(text)
        },
        (next) => {
          setCamera(next)
        },
      ),
    )
  })

  return (
    <Show
      when={props.cameraMode !== 'off'}
      fallback={
        <div class="flex min-h-[60vh] flex-col items-center justify-center p-8">
          <div class="text-center text-3xl font-semibold opacity-80">{labels().ready ?? READY}</div>
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
