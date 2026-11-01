import { Show, createSignal, onCleanup, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import { createQrDetector } from './barcode.ts'

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

// The camera loop starts once, on mount. Props are read when they are used, so
// a parent passing a fresh `onInput` never reopens the camera mid-scan.
const startCamera = (
  video: HTMLVideoElement,
  onCode: (text: string) => void,
  onState: (state: 'on' | 'unavailable') => void,
): (() => void) => {
  const detector = createQrDetector()
  if (detector === null) {
    onState('unavailable')
    return () => {
      // Nothing was opened.
    }
  }
  let stream: MediaStream | null = null
  let frame = 0
  let stopped = false
  const loop = async (): Promise<void> => {
    if (stopped) {
      return
    }
    try {
      const [first] = await detector.detect(video)
      if (first !== undefined) {
        onCode(first.rawValue)
        return
      }
    } catch {
      // a frame that cannot be decoded is not an error
    }
    frame = requestAnimationFrame(() => {
      void loop()
    })
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
      void loop()
    } catch {
      onState('unavailable')
    }
  }
  void start()
  return () => {
    stopped = true
    cancelAnimationFrame(frame)
    for (const track of stream?.getTracks() ?? []) {
      track.stop()
    }
  }
}

// Camera loop: one detect() per animation frame while the video plays. The
// paste box is always present so a device without BarcodeDetector still works.
//
// `autoFocus` is for an unattended reader — a USB keyboard-wedge QR scanner
// types the payload and presses Enter, so the box has to already hold focus and
// take it back after a stray click. It is opt-in because the member app renders
// this same component on a phone, where focusing a text input raises the
// on-screen keyboard over the page.
//
// `cameraMode: 'off'` is for a reader-only station on a device without
// BarcodeDetector — every WebKit browser, so every iPad and iPhone. There the
// camera branch can only ever end in failure, and a warning badge above a paste
// box is the wrong thing to show a queue. This mode renders one waiting line
// instead: no camera, no field, nothing focused. The scan then arrives through
// the caller's own document-level listener, which must be wired before use.
export const Scanner = (props: ScannerProps): JSX.Element => {
  const labels = (): ScannerLabels => props.labels ?? DEFAULT_LABELS
  const [camera, setCamera] = createSignal<'idle' | 'on' | 'unavailable'>('idle')
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
          <video
            ref={(el) => {
              video = el
            }}
            class="rounded-box bg-base-300 w-full max-w-md"
            playsinline
            muted
          />
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
