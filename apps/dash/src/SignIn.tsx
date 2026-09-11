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
    <div class="flex justify-end">{appearance}</div>
    <div class="card bg-base-200 mx-auto mt-16 flex max-w-md flex-col gap-6 px-8 pt-12 pb-15">
      <div class="dash-auth-logo-intro">{FudaMark({ class: 'dash-auth-logo' })}</div>
      <h1 class="dash-auth-title">{copy.title}</h1>
      {error === null ? null : (
        <p role="alert" class="alert alert-error">
          {error}
        </p>
      )}

      <button class="btn btn-primary" disabled={pending} onClick={onPasskey} type="button">
        <FingerprintSimple />
        {pending ? copy.signingIn : copy.passkey}
      </button>
      <p class="text-center text-sm opacity-70">{copy.passkeyHint}</p>

      <details class="dash-auth-admin">
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
    </div>
  </main>
)

// The admin credential stays in memory; App persists only operator sessions
// (docs/specs/pass-types-and-flows.md#surfaces).
export const SignIn = (props: SignInProps): JSX.Element => {
  const [value, setValue] = useState('')
  return <SignInView {...props} onValue={setValue} value={value} />
}
