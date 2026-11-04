import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import type { JSX } from 'solid-js'

import type { SignedDisplay } from '../signed-gate.ts'
import { ENTRY_COPY, entryMessage } from './entry-copy.ts'

const TONE = {
  green: 'bg-success text-success-content',
  red: 'bg-error text-error-content',
} as const

// Full-screen and unmissable from arm's length: the whole verdict is the button
// that clears it, so it can be dismissed at the door without aiming.
export const Verdict = (props: {
  state: SignedDisplay
  onDone: () => void
  locale?: Locale
}): JSX.Element => {
  const locale = (): Locale => props.locale ?? DEFAULT_LOCALE
  const c = (): (typeof ENTRY_COPY)[Locale] => pick(ENTRY_COPY, locale())
  return (
    <button
      type="button"
      class={`fixed inset-0 flex flex-col items-center justify-center gap-4 ${TONE[props.state.tone]}`}
      onClick={() => {
        props.onDone()
      }}
    >
      {props.state.banner === 'network' ? <div class="badge badge-neutral">{c().networkBanner}</div> : null}
      <div class="px-6 text-center text-5xl font-black">{c().verdict[props.state.title]}</div>
      <div class="px-6 text-center text-xl wrap-anywhere">{entryMessage(props.state.detail, locale())}</div>
      <div class="text-sm opacity-70">{c().tryAgain}</div>
    </button>
  )
}
