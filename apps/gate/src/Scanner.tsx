/** @jsxImportSource hono/jsx/dom */
import { useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { createQrDetector } from './barcode.ts'

// Camera loop: one detect() per animation frame while the video plays. The
// paste box is always present so a device without BarcodeDetector still works.
export const Scanner = ({ onInput }: { onInput: (text: string) => void }): JSX.Element => {
  const video = useRef<HTMLVideoElement>(null)
  const [camera, setCamera] = useState<'idle' | 'on' | 'unavailable'>('idle')
  const [pasted, setPasted] = useState('')

  useEffect(() => {
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
          onInput(first.rawValue)
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
  }, [onInput])

  return (
    <div class="flex flex-col items-center gap-4 p-4">
      <video ref={video} class="rounded-box bg-base-300 w-full max-w-md" playsinline muted />
      {camera === 'unavailable' ? (
        <div class="badge badge-warning">camera unavailable — paste below</div>
      ) : null}
      <form
        class="join w-full max-w-md"
        onSubmit={(e) => {
          e.preventDefault()
          onInput(pasted)
        }}
      >
        <input
          class="input join-item w-full"
          placeholder="paste fuda:v1:… or 0x…"
          value={pasted}
          onInput={(e) => {
            if (e.currentTarget instanceof HTMLInputElement) {
              setPasted(e.currentTarget.value)
            }
          }}
        />
        <button type="submit" class="btn btn-primary join-item">
          Check
        </button>
      </form>
    </div>
  )
}
