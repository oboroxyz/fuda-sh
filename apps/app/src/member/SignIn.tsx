/** @jsxImportSource hono/jsx/dom */
import { AUTH_COPY, DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import type { SignInFailure } from '@fuda/libs/auth'
import { FingerprintSimple } from '@fuda/ui'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { MEMBER_COPY } from './copy.ts'

export const SignIn = ({
  locale = DEFAULT_LOCALE,
  busy,
  failure,
  onCancel,
  onNavigate,
  onSignIn,
}: {
  locale?: Locale
  busy: boolean
  failure: SignInFailure | null
  onCancel: () => void
  onNavigate: (path: string) => void
  onSignIn: () => void
}): JSX.Element => {
  const copy = pick(MEMBER_COPY, locale)
  return (
    <main class="member-auth-page">
      <a
        class="font-display text-3xl font-bold"
        href="/"
        onClick={(event) => {
          if (event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault()
            onNavigate('/')
          }
        }}
      >
        fuda
      </a>
      <section class="member-panel flex w-full flex-col gap-5">
        <div>
          <p class="text-xs font-semibold tracking-widest text-[var(--fuda-muted)] uppercase">
            {copy.common.member}
          </p>
          <h1 class="member-heading mt-2">{copy.auth.title}</h1>
        </div>
        <p class="text-sm leading-relaxed text-[var(--fuda-muted)]">{copy.auth.description}</p>
        {failure === null ? null : <div class="alert alert-error">{copy.auth.failures[failure]}</div>}
        <button class="btn btn-primary w-full" disabled={busy} type="button" onClick={onSignIn}>
          <FingerprintSimple />
          {busy ? pick(AUTH_COPY, locale).signingIn : pick(AUTH_COPY, locale).signInWithPasskey}
        </button>
        {busy ? (
          <button class="btn btn-ghost w-full" type="button" onClick={onCancel}>
            {copy.common.cancel}
          </button>
        ) : null}
      </section>
    </main>
  )
}
