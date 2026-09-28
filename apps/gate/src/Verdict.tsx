/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DisplayState, VerdictFacts } from './verdict.ts'

const TONE = {
  green: 'bg-success text-success-content',
  red: 'bg-error text-error-content',
  yellow: 'bg-warning text-warning-content',
} as const

// What was presented, under the verdict word: what kind of right it is, how long
// it lasts, and the holder. Each line is omitted when the api did not report it,
// so a NOT_FOUND stays a bare REJECT.
//
// The delegation comes last and small. It is the chain of authority the Right was
// issued under — fuda's own root for every Right this deployment signs — so it
// reads as provenance. Given the top line it would be mistaken for the venue,
// which is not in a verdict at all.
const Facts = ({ facts }: { facts: VerdictFacts }): JSX.Element | null => {
  const grade = [facts.tier, facts.usage].filter((part) => part !== null).join(' · ')
  if (facts.delegation === null && grade === '' && facts.validUntil === null && facts.holder === null) {
    return null
  }
  return (
    <div class="flex flex-col items-center gap-1 px-6 text-center">
      {grade === '' ? null : <div class="text-2xl font-semibold">{grade}</div>}
      {facts.validUntil === null ? null : (
        <div class="text-base opacity-80">valid until {facts.validUntil}</div>
      )}
      {facts.holder === null ? null : <div class="font-mono text-sm opacity-70">{facts.holder}</div>}
      {facts.delegation === null ? null : (
        <div class="text-xs opacity-60">issued under {facts.delegation}</div>
      )}
    </div>
  )
}

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
    {state.detail === '' ? null : <div class="px-6 text-center text-xl">{state.detail}</div>}
    <Facts facts={state.facts} />
    {state.badge === null ? null : (
      // The chip names the claim, never the verifier behind it, so swapping the
      // verifier for a kind stays invisible to every client. The badge outlives
      // the right it is on, so it can appear beside a REJECT.
      <div class="flex flex-col items-center gap-1">
        <div class="badge badge-neutral">verified human</div>
        <div class="text-xs opacity-70">{state.badge.at}</div>
      </div>
    )}
    <div class="text-sm opacity-70">tap to scan again</div>
  </button>
)
