/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DisplayState } from './verdict.ts'

const TONE = {
  green: 'bg-success text-success-content',
  red: 'bg-error text-error-content',
  yellow: 'bg-warning text-warning-content',
} as const

// Full-screen and unmissable from arm's length: the whole verdict is the button
// that clears it, so a member of staff can dismiss it without aiming.
export const Verdict = ({ state, onDone }: { state: DisplayState; onDone: () => void }): JSX.Element => (
  <button
    type="button"
    class={`fixed inset-0 flex flex-col items-center justify-center gap-4 ${TONE[state.tone]}`}
    onClick={onDone}
  >
    {state.tone === 'red' && state.banner === 'network' ? (
      <div class="badge badge-neutral">network error — gate fails closed</div>
    ) : null}
    <div class="px-6 text-center text-5xl font-black">{state.title}</div>
    <div class="px-6 text-center text-xl">{state.detail}</div>
    <div class="text-sm opacity-70">tap to scan again</div>
  </button>
)
