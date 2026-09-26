import { Scanner } from '@fuda/ui'
/** @jsxImportSource hono/jsx/dom */
import { useCallback, useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { admitQr, previewUid } from './api.ts'
import { classifyInput, displayState, unreadableInput } from './verdict.ts'
import type { DisplayState } from './verdict.ts'
import { Verdict } from './Verdict.tsx'
import { EMPTY_WEDGE, wedgeKey } from './wedge.ts'

export const App = (): JSX.Element => {
  const [state, setState] = useState<DisplayState | null>(null)
  const [busy, setBusy] = useState(false)

  const onInput = useCallback(
    async (text: string) => {
      if (busy) {
        return
      }
      const input = classifyInput(text)
      if (input.kind === 'invalid') {
        setState(unreadableInput())
        return
      }
      setBusy(true)
      const result = input.kind === 'preview' ? await previewUid(input.uid) : await admitQr(input.qr)
      setState(displayState(input.kind, result))
      setBusy(false)
    },
    [busy],
  )

  // A desk scanner keeps reading while a verdict fills the screen, where there
  // is no input to type into. The document catches those keystrokes so the next
  // member's scan replaces the verdict instead of being lost (see wedge.ts).
  // Keys typed into the Scanner's own box are left to the box.
  const latest = useRef(onInput)
  latest.current = onInput
  useEffect(() => {
    let buffer = EMPTY_WEDGE
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }
      const step = wedgeKey(buffer, event.key, Date.now())
      buffer = step.next
      if (step.done !== null) {
        // The verdict is a button: its Enter activation would clear the state
        // this scan is about to set.
        event.preventDefault()
        void latest.current(step.done)
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
      </header>
      {state === null ? (
        <Scanner
          autoFocus
          onInput={(t) => {
            void onInput(t)
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
