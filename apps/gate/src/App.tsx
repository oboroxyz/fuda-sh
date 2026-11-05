import { Scanner } from '@fuda/ui-preact'
import type { JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'

import { admitQr, previewUid } from './api.ts'
import { cameraMode, venueHandle } from './config.ts'
import { classifyInput, displayState, unreadableInput } from './verdict.ts'
import type { DisplayState } from './verdict.ts'
import { Verdict } from './Verdict.tsx'
import { EMPTY_WEDGE, wedgeKey } from './wedge.ts'

export const App = (): JSX.Element => {
  const venue = venueHandle(window.location.search)
  const [state, setState] = useState<DisplayState | null>(null)
  const busy = useRef(false)
  const buffer = useRef(EMPTY_WEDGE)

  const onInput = async (text: string): Promise<void> => {
    if (busy.current) {
      return
    }
    const input = classifyInput(text)
    if (input.kind === 'invalid') {
      setState(unreadableInput())
      return
    }
    busy.current = true
    try {
      const result = input.kind === 'preview' ? await previewUid(input.uid) : await admitQr(input.qr, venue)
      setState(displayState(input.kind, result))
    } finally {
      busy.current = false
    }
  }
  const latestInput = useRef(onInput)
  latestInput.current = onInput

  // The reader can fire before paint and while a verdict has no input box.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }
      const step = wedgeKey(buffer.current, event.key, Date.now())
      buffer.current = step.next
      if (step.done !== null) {
        // Enter would otherwise activate the verdict button and erase this scan.
        event.preventDefault()
        void latestInput.current(step.done)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <main class="min-h-screen">
      <header class="navbar bg-base-200">
        <span class="px-2 text-xl font-bold">fuda gate</span>
        <div class="ml-auto px-2 text-sm">
          {venue === null ? (
            <span class="badge badge-warning h-auto py-1 text-center whitespace-normal">
              no venue set: any shop's pass is admitted
            </span>
          ) : (
            <span class="opacity-70">checking for @{venue}</span>
          )}
        </div>
      </header>
      {state === null ? (
        <Scanner
          autoFocus
          cameraMode={cameraMode(window.location.search)}
          onInput={(text) => {
            void onInput(text)
          }}
        />
      ) : (
        <Verdict
          state={state}
          onDone={() => {
            setState(null)
          }}
        />
      )}
    </main>
  )
}
