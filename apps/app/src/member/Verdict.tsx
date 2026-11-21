import { parseChainConfig } from '@fuda/chains'
import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { parseAgreementEvidence } from '@fuda/sdk'
import type { JSX } from 'preact'

import type { SignedDisplay } from '../signed-gate.ts'
import { ENTRY_COPY, entryMessage } from './entry-copy.ts'
import { LICENCE_COPY } from './licence-copy.ts'

const TONE = {
  green: 'bg-success text-success-content',
  red: 'bg-error text-error-content',
} as const

// Agreement links need their own controls rather than links nested inside a button.
export const Verdict = (props: {
  state: SignedDisplay
  onDone: () => void
  locale?: Locale
}): JSX.Element => {
  const locale = (): Locale => props.locale ?? DEFAULT_LOCALE
  const c = (): (typeof ENTRY_COPY)[Locale] => pick(ENTRY_COPY, locale())
  const Frame = props.state.requirements === undefined ? 'button' : 'div'
  return (
    <Frame
      type={Frame === 'button' ? 'button' : undefined}
      onClick={Frame === 'button' ? props.onDone : undefined}
      class={`fixed inset-0 flex flex-col items-center justify-center gap-4 ${TONE[props.state.tone]}`}
    >
      {props.state.banner === 'network' ? <div class="badge badge-neutral">{c().networkBanner}</div> : null}
      {((venue) =>
        venue !== undefined && venue !== '' ? (
          <div class="px-6 text-center text-3xl font-semibold">@{venue}</div>
        ) : null)(props.state.venue)}
      <div class="px-6 text-center text-5xl font-black">{c().verdict[props.state.title]}</div>
      <div class="px-6 text-center text-xl wrap-anywhere">{entryMessage(props.state.detail, locale())}</div>
      {props.state.requirements?.map((row) => {
        const evidence = parseAgreementEvidence(row.evidence)
        if (evidence === null) {
          return null
        }
        let explorer: string
        try {
          explorer = parseChainConfig(String(evidence.chainId)).explorerUrl
        } catch {
          return null
        }
        return (
          <a
            class="link max-w-full px-6 text-center text-sm break-all"
            key={row.evidence}
            href={`${explorer}/address/${evidence.registry}#readContract`}
            target="_blank"
            rel="noreferrer"
          >
            {pick(LICENCE_COPY, locale()).agreement} · {evidence.agreementId}
          </a>
        )
      })}
      {Frame === 'button' ? (
        <div class="text-sm opacity-70">{c().tryAgain}</div>
      ) : (
        <button class="btn btn-ghost" type="button" onClick={props.onDone}>
          {c().tryAgain}
        </button>
      )}
    </Frame>
  )
}
