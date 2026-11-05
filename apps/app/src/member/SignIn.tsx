import { AUTH_COPY, DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { FingerprintSimple } from '@fuda/ui'
import type { JSX } from 'preact'

import { TOP_PATH } from '../route.ts'
import type { PasskeyFailure } from './auth.ts'
import { MEMBER_COPY } from './copy.ts'

export const SignIn = (props: {
  locale?: Locale
  busy: 'create' | 'signin' | null
  failure: PasskeyFailure | null
  onCancel: () => void
  onNavigate: (path: string) => void
  onCreate: () => void
  onSignIn: () => void
}): JSX.Element => {
  const locale = (): Locale => props.locale ?? DEFAULT_LOCALE
  const copy = (): (typeof MEMBER_COPY)[Locale] => pick(MEMBER_COPY, locale())
  return (
    <main class="member-auth-page">
      <a
        class="font-display text-3xl font-bold"
        href={TOP_PATH}
        onClick={(event) => {
          if (event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault()
            props.onNavigate('/')
          }
        }}
      >
        fuda
      </a>
      <section class="member-panel flex w-full flex-col gap-5">
        <div>
          <p class="text-xs font-semibold tracking-widest text-[var(--fuda-muted)] uppercase">
            {copy().common.member}
          </p>
          <h1 class="member-heading mt-2">{copy().auth.title}</h1>
        </div>
        <p class="text-sm leading-relaxed text-[var(--fuda-muted)]">{copy().auth.description}</p>
        {props.failure === null ? null : (
          <div class="alert alert-error">{copy().auth.failures[props.failure]}</div>
        )}
        <button
          class="btn btn-primary w-full"
          disabled={props.busy !== null}
          type="button"
          onClick={() => {
            props.onSignIn()
          }}
        >
          <FingerprintSimple />
          {props.busy === 'signin'
            ? pick(AUTH_COPY, locale()).signingIn
            : pick(AUTH_COPY, locale()).signInWithPasskey}
        </button>
        <button
          class="btn btn-outline w-full"
          disabled={props.busy !== null}
          type="button"
          onClick={() => {
            props.onCreate()
          }}
        >
          {props.busy === 'create' ? copy().auth.creating : copy().auth.createAccount}
        </button>
        {props.busy === null ? null : (
          <button
            class="btn btn-ghost w-full"
            type="button"
            onClick={() => {
              props.onCancel()
            }}
          >
            {copy().common.cancel}
          </button>
        )}
      </section>
    </main>
  )
}
