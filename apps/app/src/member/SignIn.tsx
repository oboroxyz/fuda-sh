/** @jsxImportSource hono/jsx/dom */
import type { SignInFailure } from '@fuda/libs/auth'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { SIGN_IN_FAILURE } from './copy.ts'

export const SignIn = ({
  busy,
  failure,
  onCancel,
  onNavigate,
  onSignIn,
}: {
  busy: boolean
  failure: SignInFailure | null
  onCancel: () => void
  onNavigate: (path: string) => void
  onSignIn: () => void
}): JSX.Element => (
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
        <p class="text-xs font-semibold tracking-widest text-[var(--fuda-muted)] uppercase">Member</p>
        <h1 class="member-heading mt-2">Your passes, in one place</h1>
      </div>
      <p class="text-sm leading-relaxed text-[var(--fuda-muted)]">
        Use Base to create an account or sign in. You’ll confirm with your wallet.
      </p>
      {failure === null ? null : <div class="alert alert-error">{SIGN_IN_FAILURE[failure]}</div>}
      <button class="btn btn-primary w-full" disabled={busy} type="button" onClick={onSignIn}>
        {busy ? 'Signing in…' : 'Sign in with Base'}
      </button>
      {busy ? (
        <button class="btn btn-ghost w-full" type="button" onClick={onCancel}>
          Cancel
        </button>
      ) : null}
    </section>
  </main>
)
