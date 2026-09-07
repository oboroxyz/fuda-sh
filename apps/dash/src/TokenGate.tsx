/** @jsxImportSource hono/jsx/dom */
import { useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'

export interface TokenGateProps {
  appearance: JSX.Element
  copy: DashCopy['auth']
  error: string | null
  onToken: (token: string) => void
}

export interface TokenGateViewProps extends TokenGateProps {
  onValue: (value: string) => void
  value: string
}

export const TokenGateView = ({
  appearance,
  copy,
  error,
  onToken,
  onValue,
  value,
}: TokenGateViewProps): JSX.Element => (
  <main class="dash-auth">
    <div class="flex justify-end">{appearance}</div>
    <form
      class="card bg-base-200 mx-auto mt-16 flex max-w-md flex-col gap-3 p-6"
      onSubmit={(e) => {
        e.preventDefault()
        onToken(value.trim())
      }}
    >
      <div class="dash-auth-logo-intro">
        <svg aria-label="fuda." class="dash-auth-logo" fill="none" role="img" viewBox="0 0 260 260">
          <path
            d="m130 54 63 50v128h-126v-128z"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="15"
          />
          <path
            d="m119 98a11 11 0 1 0 22 0 11 11 0 1 0-22 0"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="15"
          />
          <path
            d="m130 28v20"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="15"
          />
        </svg>
      </div>
      <h1 class="dash-auth-title">{copy.title}</h1>
      <p class="text-sm opacity-70">{copy.description}</p>
      {error === null ? null : (
        <p role="alert" class="alert alert-error">
          {error}
        </p>
      )}
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
      <button class="btn btn-primary" type="submit">
        {copy.continue}
      </button>
    </form>
  </main>
)

// The token is fuda's API authorization for this Venue, held in memory for the
// tab's lifetime only — never localStorage, never a cookie (docs/specs/pass-types-and-flows.md#surfaces).
export const TokenGate = (props: TokenGateProps): JSX.Element => {
  const [value, setValue] = useState('')
  return <TokenGateView {...props} onValue={setValue} value={value} />
}
