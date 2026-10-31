import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

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
const Facts = (props: { facts: VerdictFacts }): JSX.Element => {
  const grade = (): string =>
    [props.facts.tier, props.facts.usage].filter((part) => part !== null).join(' · ')
  const empty = (): boolean =>
    props.facts.delegation === null &&
    grade() === '' &&
    props.facts.validUntil === null &&
    props.facts.holder === null
  return (
    <Show when={!empty()}>
      <div class="flex flex-col items-center gap-1 px-6 text-center">
        <Show when={grade() !== ''}>
          <div class="text-2xl font-semibold">{grade()}</div>
        </Show>
        <Show when={props.facts.validUntil}>
          {(validUntil) => <div class="text-base opacity-80">valid until {validUntil()}</div>}
        </Show>
        <Show when={props.facts.holder}>
          {(holder) => <div class="font-mono text-sm opacity-70">{holder()}</div>}
        </Show>
        <Show when={props.facts.delegation}>
          {(delegation) => <div class="text-xs opacity-60">issued under {delegation()}</div>}
        </Show>
      </div>
    </Show>
  )
}

// Full-screen and unmissable from arm's length: the whole verdict is the button
// that clears it, so a member of staff can dismiss it without aiming.
export const Verdict = (props: { state: DisplayState; onDone: () => void }): JSX.Element => (
  <button
    type="button"
    class={`fixed inset-0 flex flex-col items-center justify-center gap-4 ${TONE[props.state.tone]}`}
    onClick={() => {
      props.onDone()
    }}
  >
    <Show when={props.state.tone === 'red' && props.state.banner === 'network'}>
      <div class="badge badge-neutral">network error — gate fails closed</div>
    </Show>
    <div class="px-6 text-center text-5xl font-black">{props.state.title}</div>
    <Show when={props.state.detail !== ''}>
      <div class="px-6 text-center text-xl">{props.state.detail}</div>
    </Show>
    <Facts facts={props.state.facts} />
    <Show when={props.state.badge}>
      {(badge) => (
        // The chip names the claim, never the verifier behind it, so swapping the
        // verifier for a kind stays invisible to every client. The badge outlives
        // the right it is on, so it can appear beside a REJECT.
        <div class="flex flex-col items-center gap-1">
          <div class="badge badge-neutral">verified human</div>
          <div class="text-xs opacity-70">{badge().at}</div>
        </div>
      )}
    </Show>
    <div class="text-sm opacity-70">tap to scan again</div>
  </button>
)
