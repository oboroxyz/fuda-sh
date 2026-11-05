import { startCamera } from '@fuda/ui/camera'
import { SCANNER_LABELS, SCANNER_READY } from '@fuda/ui/scanner'
import type { ScannerProps } from '@fuda/ui/scanner'
import type { JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'

export const Scanner = (props: ScannerProps): JSX.Element => {
  const labels = props.labels ?? SCANNER_LABELS
  const [camera, setCamera] = useState<'idle' | 'on' | 'done' | 'unavailable'>('idle')
  const [pasted, setPasted] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const box = useRef<HTMLInputElement>(null)
  const latestInput = useRef(props.onInput)
  latestInput.current = props.onInput

  useLayoutEffect(() => {
    if (props.autoFocus === true) {
      box.current?.focus()
    }
    if (props.cameraMode === 'off' || video.current === null) {
      return
    }
    const session = startCamera({
      onCode: (text) => {
        latestInput.current(text)
      },
      onState: setCamera,
      video: video.current,
    })
    return session.release
  }, [])

  return props.cameraMode === 'off' ? (
    <div class="flex min-h-[60vh] flex-col items-center justify-center p-8">
      <div class="text-center text-3xl font-semibold opacity-80">{labels.ready ?? SCANNER_READY}</div>
    </div>
  ) : (
    <div
      class="flex flex-col items-center gap-4 p-4"
      onClick={() => {
        if (props.autoFocus === true) {
          box.current?.focus()
        }
      }}
    >
      {camera === 'unavailable' ? <div class="badge badge-warning">{labels.cameraUnavailable}</div> : null}
      {camera === 'idle' || camera === 'on' ? (
        <video ref={video} class="rounded-box bg-base-300 w-full max-w-md" playsInline muted />
      ) : null}
      <form
        class="join w-full max-w-md"
        onSubmit={(event) => {
          event.preventDefault()
          props.onInput(box.current?.value ?? pasted)
        }}
      >
        <input
          ref={box}
          class="input join-item w-full"
          placeholder={labels.placeholder}
          aria-label={labels.placeholder}
          value={pasted}
          onInput={(event) => {
            setPasted(event.currentTarget.value)
          }}
        />
        <button type="submit" class="btn btn-primary join-item">
          {labels.check}
        </button>
      </form>
    </div>
  )
}
