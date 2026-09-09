/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { SignedDisplay } from '../signed-gate.ts'

const TONE = {
  green: 'bg-success text-success-content',
  red: 'bg-error text-error-content',
} as const

// Full-screen and unmissable from arm's length: the whole verdict is the button
// that clears it, so it can be dismissed at the door without aiming.
export const Verdict = ({ state, onDone }: { state: SignedDisplay; onDone: () => void }): JSX.Element => (
  <button
    type="button"
    class={`fixed inset-0 flex flex-col items-center justify-center gap-4 ${TONE[state.tone]}`}
    onClick={onDone}
  >
    {state.banner === 'network' ? (
      <div class="badge badge-neutral">network error — the gate fails closed</div>
    ) : null}
    <div class="px-6 text-center text-5xl font-black">{state.title}</div>
    <div class="px-6 text-center text-xl break-all">{state.detail}</div>
    <div class="text-sm opacity-70">tap to try again</div>
  </button>
)
