import { Scanner } from '@fuda/ui'
import { Show, createSignal, onCleanup, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import { admitQr, previewUid } from './api.ts'
import { cameraMode, venueHandle } from './config.ts'
import { classifyInput, displayState, unreadableInput } from './verdict.ts'
import type { DisplayState } from './verdict.ts'
import { Verdict } from './Verdict.tsx'
import { EMPTY_WEDGE, wedgeKey } from './wedge.ts'

export const App = (): JSX.Element => {
  const venue = venueHandle(window.location.search)
  const [state, setState] = createSignal<DisplayState | null>(null)
  let busy = false

  const onInput = async (text: string): Promise<void> => {
    if (busy) {
      return
    }
    const input = classifyInput(text)
    if (input.kind === 'invalid') {
      setState(unreadableInput())
      return
    }
    busy = true
    const result = input.kind === 'preview' ? await previewUid(input.uid) : await admitQr(input.qr, venue)
    setState(displayState(input.kind, result))
    busy = false
  }

  // A desk scanner keeps reading while a verdict fills the screen, where there
  // is no input to type into. The document catches those keystrokes so the next
  // member's scan replaces the verdict instead of being lost (see wedge.ts).
  // Keys typed into the Scanner's own box are left to the box.
  onMount(() => {
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
        void onInput(step.done)
      }
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => {
      document.removeEventListener('keydown', onKey)
    })
  })

  return (
    <main class="min-h-screen">
      <header class="navbar bg-base-200">
        <span class="px-2 text-xl font-bold">fuda gate</span>
        <div class="ml-auto px-2 text-sm">
          <Show
            when={venue}
            fallback={
              <span class="badge badge-warning h-auto py-1 text-center whitespace-normal">
                no venue set: any shop's pass is admitted
              </span>
            }
          >
            {(handle) => <span class="opacity-70">checking for @{handle()}</span>}
          </Show>
        </div>
      </header>
      <Show
        when={state()}
        fallback={
          <Scanner
            autoFocus
            cameraMode={cameraMode(window.location.search)}
            onInput={(t) => {
              void onInput(t)
            }}
          />
        }
      >
        {(current) => (
          <Verdict
            state={current()}
            onDone={() => {
              setState(null)
            }}
          />
        )}
      </Show>
    </main>
  )
}
