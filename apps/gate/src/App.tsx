import { Scanner } from '@fuda/ui'
import type { JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'

import { admitQr, previewUid } from './api.ts'
import { cameraMode, venueHandle } from './config.ts'
import { copy } from './copy.ts'
import { classifyInput, displayState, unreadableInput } from './verdict.ts'
import type { DisplayState } from './verdict.ts'
import { Verdict } from './Verdict.tsx'
import { EMPTY_WEDGE, wedgeKey } from './wedge.ts'

type ScanState =
  | { kind: 'scanning' }
  | {
      kind: 'checking'
      controller: AbortController
      timer: ReturnType<typeof setTimeout>
      ignored: boolean
    }
  | { kind: 'verdict'; display: DisplayState }

const failedCheck = (): DisplayState =>
  displayState('admit', {
    error: copy.couldNotCheck,
    network: true,
    ok: false,
    status: 0,
  })

export const App = (): JSX.Element => {
  const venue = venueHandle(window.location.search)
  const [state, renderState] = useState<ScanState>({ kind: 'scanning' })
  const current = useRef(state)
  const setState = (next: ScanState): void => {
    current.current = next
    renderState(next)
  }
  const buffer = useRef(EMPTY_WEDGE)

  const onInput = async (text: string): Promise<void> => {
    if (current.current.kind === 'checking') {
      setState({ ...current.current, ignored: true })
      return
    }
    const input = classifyInput(text)
    if (input.kind === 'invalid') {
      setState({ display: unreadableInput(), kind: 'verdict' })
      return
    }
    const controller = new AbortController()
    const finish = (display: DisplayState): void => {
      const active = current.current
      if (active.kind !== 'checking' || active.controller !== controller) {
        return
      }
      clearTimeout(active.timer)
      setState({ display, kind: 'verdict' })
    }
    const timer = setTimeout(() => {
      controller.abort()
      finish(failedCheck())
    }, 10_000)
    setState({ controller, ignored: false, kind: 'checking', timer })
    try {
      const result =
        input.kind === 'preview'
          ? await previewUid(input.uid, controller.signal)
          : await admitQr(input.qr, venue, controller.signal)
      finish(displayState(input.kind, result))
    } catch {
      finish(failedCheck())
    }
  }
  const latestInput = useRef(onInput)
  latestInput.current = onInput

  useLayoutEffect(() => {
    if (state.kind !== 'verdict') {
      return
    }
    const timer = setTimeout(
      () => {
        if (current.current !== state) {
          return
        }
        setState({ kind: 'scanning' })
      },
      state.display.tone === 'green' ? 5000 : 10_000,
    )
    return () => {
      clearTimeout(timer)
    }
  }, [state])

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
      const active = current.current
      current.current = { kind: 'scanning' }
      if (active.kind === 'checking') {
        clearTimeout(active.timer)
        active.controller.abort()
      }
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
      {state.kind === 'scanning' ? (
        <Scanner
          autoFocus
          cameraMode={cameraMode(window.location.search)}
          onInput={(text) => {
            void onInput(text)
          }}
        />
      ) : null}
      {state.kind === 'checking' ? (
        <div
          role="status"
          class="bg-base-100 text-base-content fixed inset-0 flex flex-col items-center justify-center gap-4"
        >
          <div class="px-6 text-center text-5xl font-black">{copy.checking}</div>
          {state.ignored ? <div class="px-6 text-center text-xl">{copy.ignored}</div> : null}
        </div>
      ) : null}
      {state.kind === 'verdict' ? (
        <Verdict
          state={state.display}
          onDone={() => {
            setState({ kind: 'scanning' })
          }}
        />
      ) : null}
    </main>
  )
}
