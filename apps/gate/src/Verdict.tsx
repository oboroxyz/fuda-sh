import type { JSX } from 'preact'

import type { DisplayState, VerdictFacts } from './verdict.ts'

const TONE = {
  green: 'bg-success text-success-content',
  red: 'bg-error text-error-content',
  yellow: 'bg-warning text-warning-content',
} as const

const Facts = (props: { facts: VerdictFacts }): JSX.Element | null => {
  const { facts } = props
  const grade = [facts.tier, facts.usage].filter((part) => part !== null).join(' · ')
  const rows = [
    { className: 'text-2xl font-semibold', kind: 'grade', prefix: '', value: grade },
    { className: 'text-base opacity-80', kind: 'expiry', prefix: 'valid until ', value: facts.validUntil },
    { className: 'font-mono text-sm opacity-70', kind: 'holder', prefix: '', value: facts.holder },
    { className: 'text-xs opacity-60', kind: 'delegation', prefix: 'issued under ', value: facts.delegation },
  ].filter((row) => row.value !== null && row.value !== '')
  return rows.length === 0 ? null : (
    <div class="flex flex-col items-center gap-1 px-6 text-center">
      {rows.map((row) => (
        <div class={row.className} key={row.kind}>
          {row.prefix}
          {row.value}
        </div>
      ))}
    </div>
  )
}

// The whole verdict dismisses it so staff can tap without aiming.
export const Verdict = (props: { state: DisplayState; onDone: () => void }): JSX.Element => (
  <button
    type="button"
    class={`fixed inset-0 flex flex-col items-center justify-center gap-4 ${TONE[props.state.tone]}`}
    onClick={() => {
      props.onDone()
    }}
  >
    {props.state.tone === 'red' && props.state.banner === 'network' ? (
      <div class="badge badge-neutral">network error — gate fails closed</div>
    ) : null}
    <div class="px-6 text-center text-5xl font-black">{props.state.title}</div>
    {props.state.detail === '' ? null : <div class="px-6 text-center text-xl">{props.state.detail}</div>}
    <Facts facts={props.state.facts} />
    {props.state.badge === null ? null : (
      <div class="flex flex-col items-center gap-1">
        <div class="badge badge-neutral">verified human</div>
        <div class="text-xs opacity-70">{props.state.badge.at}</div>
      </div>
    )}
    <div class="text-sm opacity-70">tap to scan again</div>
  </button>
)
