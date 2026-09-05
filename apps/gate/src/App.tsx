import { Scanner } from '@fuda/web-kit'
/** @jsxImportSource hono/jsx/dom */
import { useCallback, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { admitQr, previewUid } from './api.ts'
import { classifyInput, displayState } from './verdict.ts'
import type { DisplayState } from './verdict.ts'
import { Verdict } from './Verdict.tsx'

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
        setState({ detail: 'not a fuda pass', title: 'REJECT', tone: 'red' })
        return
      }
      setBusy(true)
      const result = input.kind === 'preview' ? await previewUid(input.uid) : await admitQr(input.qr)
      setState(displayState(input.kind, result))
      setBusy(false)
    },
    [busy],
  )

  return (
    <main class="min-h-screen">
      <header class="navbar bg-base-200">
        <span class="px-2 text-xl font-bold">fuda gate</span>
      </header>
      {state === null ? (
        <Scanner
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
