/** @jsxImportSource hono/jsx/dom */
import { FingerprintSimple, FudaMark } from '@fuda/ui'
import { useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'
import type { SignInFailure } from './operator-sign-in.ts'

export interface SignInProps {
  appearance: JSX.Element
  copy: DashCopy['auth']
  error: string | null
  onPasskey: () => void
  onToken: (token: string) => void
  pending: boolean
}

export interface SignInViewProps extends SignInProps {
  onValue: (value: string) => void
  value: string
}

export const signInErrorOf = (copy: DashCopy['auth'], failure: SignInFailure): string =>
  copy.failures[failure]

export const SignInView = ({
  appearance,
  copy,
  error,
  onPasskey,
  onToken,
  onValue,
  pending,
  value,
}: SignInViewProps): JSX.Element => (
  <main class="dash-auth">
    <div class="dash-auth-appearance">{appearance}</div>
    <div class="mx-auto flex w-full max-w-[30rem] flex-col gap-8 px-5 py-8 sm:px-8 sm:py-12">
      <header class="flex flex-col items-center gap-4 border-b border-[var(--fuda-border)] pb-5">
        <div class="dash-auth-logo-intro">{FudaMark({ class: 'dash-auth-logo' })}</div>
        <span class="font-display text-3xl font-bold">fuda</span>
      </header>
      <section class="flex flex-col items-start gap-6 py-4">
        <h1 class="dash-auth-title">{copy.title}</h1>
        <p class="text-base leading-relaxed text-[var(--fuda-muted)]">{copy.passkeyHint}</p>
        {error === null ? null : (
          <p role="alert" class="alert alert-error">
            {error}
          </p>
        )}

        <button class="btn btn-primary w-full gap-2" disabled={pending} onClick={onPasskey} type="button">
          <FingerprintSimple />
          {pending ? copy.signingIn : copy.passkey}
        </button>

        <details class="dash-auth-admin w-full">
          <summary>{copy.adminSection}</summary>
          <form
            class="mt-3 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              onToken(value.trim())
            }}
          >
            <p class="text-sm opacity-70">{copy.description}</p>
            <label for="admin-token">{copy.tokenLabel}</label>
            <input
              id="admin-token"
              class="input w-full"
              type="password"
              placeholder={copy.tokenPlaceholder}
              value={value}
              onInput={(e) => {
                if (e.currentTarget instanceof HTMLInputElement) {
                  onValue(e.currentTarget.value)
                }
              }}
            />
            <button class="btn" type="submit">
              {copy.continue}
            </button>
          </form>
        </details>
      </section>
    </div>
  </main>
)

// The admin credential stays in memory; App persists only operator sessions
// (docs/specs/pass-types-and-flows.md#surfaces).
export const SignIn = (props: SignInProps): JSX.Element => {
  const [value, setValue] = useState('')
  return <SignInView {...props} onValue={setValue} value={value} />
}
