/** @jsxImportSource hono/jsx/dom */
import { useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { createQrDetector } from './barcode.ts'

interface ScannerLabels {
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
export const Scanner = ({
  onInput,
  labels = DEFAULT_LABELS,
  autoFocus = false,
  cameraMode = 'auto',
}: {
  onInput: (text: string) => void
  labels?: ScannerLabels
  autoFocus?: boolean
  cameraMode?: 'auto' | 'off'
}): JSX.Element => {
  const video = useRef<HTMLVideoElement>(null)
  const box = useRef<HTMLInputElement>(null)
  const [camera, setCamera] = useState<'idle' | 'on' | 'unavailable'>('idle')
  const [pasted, setPasted] = useState('')

  useEffect(() => {
    if (autoFocus) {
      box.current?.focus()
    }
  }, [autoFocus])

  // The effect runs once: a parent that passes a fresh `onInput` on every render
  // would otherwise tear down and reopen the camera mid-scan. The ref keeps the
  // callback current without putting it in the dependency list.
  const latest = useRef(onInput)
  latest.current = onInput

  useEffect(() => {
    if (cameraMode === 'off') {
      return
    }
    const detector = createQrDetector()
    const el = video.current
    if (detector === null || el === null) {
      setCamera('unavailable')
      return
    }
    let stream: MediaStream | null = null
    let frame = 0
    let stopped = false
    const loop = async (): Promise<void> => {
      if (stopped) {
        return
      }
      try {
        const codes = await detector.detect(el)
        const [first] = codes
        if (first !== undefined) {
          latest.current(first.rawValue)
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
        // The permission prompt and the device open can outlive this effect: a
        // stream that arrives after cleanup would keep the camera lit forever.
        if (stopped) {
          for (const track of stream.getTracks()) {
            track.stop()
          }
          return
        }
        el.srcObject = stream
        await el.play()
        setCamera('on')
        void loop()
      } catch {
        setCamera('unavailable')
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
  }, [cameraMode])

  if (cameraMode === 'off') {
    return (
      <div class="flex min-h-[60vh] flex-col items-center justify-center p-8">
        <div class="text-center text-3xl font-semibold opacity-80">{labels.ready ?? READY}</div>
      </div>
    )
  }

  return (
    <div
      class="flex flex-col items-center gap-4 p-4"
      onClick={
        autoFocus
          ? () => {
              box.current?.focus()
            }
          : undefined
      }
    >
      {camera === 'unavailable' ? (
        <div class="badge badge-warning">{labels.cameraUnavailable}</div>
      ) : (
        <video ref={video} class="rounded-box bg-base-300 w-full max-w-md" playsinline muted />
      )}
      <form
        class="join w-full max-w-md"
        onSubmit={(e) => {
          e.preventDefault()
          onInput(pasted)
        }}
      >
        <input
          ref={box}
          class="input join-item w-full"
          placeholder={labels.placeholder}
          aria-label={labels.placeholder}
          value={pasted}
          onInput={(e) => {
            if (e.currentTarget instanceof HTMLInputElement) {
              setPasted(e.currentTarget.value)
            }
          }}
        />
        <button type="submit" class="btn btn-primary join-item">
          {labels.check}
        </button>
      </form>
    </div>
  )
}
