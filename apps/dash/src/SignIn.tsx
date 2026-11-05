import { FingerprintSimple, FudaMark } from '@fuda/ui'
import type { JSX } from 'preact'
import { useState } from 'preact/hooks'

import type { DashCopy } from './copy.ts'
import type { OperatorSignInFailure } from './operator-sign-in.ts'

export interface SignInProps {
  appearance: JSX.Element
  copy: DashCopy['auth']
  error: string | null
  busy: SignInMethod | null
  onCancel: () => void
  onCreate: () => void
  onSignIn: () => void
  onToken: (token: string) => void
  onWallet: () => void
}

export type SignInMethod = 'create' | 'signin' | 'wallet'

export const signInErrorOf = (copy: DashCopy['auth'], failure: OperatorSignInFailure): string =>
  copy.failures[failure]

// The admin credential stays in memory; App persists only operator sessions
// (docs/specs/pass-types-and-flows.md#surfaces).
export const SignIn = (props: SignInProps): JSX.Element => {
  const [value, setValue] = useState('')
  return (
    <main class="dash-auth">
      <div class="dash-auth-appearance">{props.appearance}</div>
      <div class="mx-auto flex w-full max-w-[30rem] flex-col gap-8 px-5 py-8 sm:px-8 sm:py-12">
        <header class="flex flex-col items-center gap-4 border-b border-[var(--fuda-border)] pb-5">
          <div class="dash-auth-logo-intro">
            <FudaMark class="dash-auth-logo" />
          </div>
          <span class="font-display text-3xl font-bold">fuda</span>
        </header>
        <section class="flex flex-col items-start gap-6 py-4">
          <h1 class="dash-auth-title">{props.copy.title}</h1>
          <p class="text-base leading-relaxed text-[var(--fuda-muted)]">{props.copy.passkeyHint}</p>
          {props.error === null ? null : (
            <p role="alert" class="alert alert-error">
              {props.error}
            </p>
          )}

          <button
            class="btn btn-primary w-full gap-2"
            disabled={props.busy !== null}
            onClick={() => {
              props.onSignIn()
            }}
            type="button"
          >
            <FingerprintSimple />
            {props.busy === 'signin' ? props.copy.signingIn : props.copy.passkey}
          </button>
          <button
            class="btn btn-outline w-full"
            disabled={props.busy !== null}
            onClick={() => {
              props.onCreate()
            }}
            type="button"
          >
            {props.busy === 'create' ? props.copy.creating : props.copy.createPasskey}
          </button>
          {props.busy === null ? null : (
            <button
              class="btn btn-ghost w-full"
              onClick={() => {
                props.onCancel()
              }}
              type="button"
            >
              {props.copy.cancel}
            </button>
          )}

          <div class="flex w-full flex-col items-start gap-1">
            <button
              class="link text-sm"
              disabled={props.busy !== null}
              onClick={() => {
                props.onWallet()
              }}
              type="button"
            >
              {props.busy === 'wallet' ? props.copy.signingInWallet : props.copy.wallet}
            </button>
            <p class="text-sm text-[var(--fuda-muted)]">{props.copy.walletHint}</p>
          </div>

          <details class="dash-auth-admin w-full">
            <summary>{props.copy.adminSection}</summary>
            <form
              class="mt-3 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                props.onToken(value.trim())
              }}
            >
              <p class="text-sm opacity-70">{props.copy.description}</p>
              <label for="admin-token">{props.copy.tokenLabel}</label>
              <input
                id="admin-token"
                class="input w-full"
                type="password"
                placeholder={props.copy.tokenPlaceholder}
                value={value}
                onInput={(e) => {
                  setValue(e.currentTarget.value)
                }}
              />
              <button class="btn" type="submit">
                {props.copy.continue}
              </button>
            </form>
          </details>
        </section>
      </div>
    </main>
  )
}
