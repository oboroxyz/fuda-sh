/** @jsxImportSource hono/jsx/dom */
import { useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

// The token is fuda's API authorization for this Venue, held in memory for the
// tab's lifetime only — never localStorage, never a cookie (spec §10).
export const TokenGate = ({ onToken }: { onToken: (t: string) => void }): JSX.Element => {
  const [value, setValue] = useState('')
  return (
    <form
      class="card bg-base-200 mx-auto mt-16 flex max-w-md flex-col gap-3 p-6"
      onSubmit={(e) => {
        e.preventDefault()
        onToken(value.trim())
      }}
    >
      <h1 class="text-xl font-bold">fuda dash</h1>
      <p class="text-sm opacity-70">
        Enter the admin token. It is kept in memory only. Leave it empty for a local api running without
        ADMIN_TOKEN.
      </p>
      <input
        class="input w-full"
        type="password"
        placeholder="ADMIN_TOKEN"
        value={value}
        onInput={(e) => {
          if (e.currentTarget instanceof HTMLInputElement) {
            setValue(e.currentTarget.value)
          }
        }}
      />
      <button class="btn btn-primary" type="submit">
        Continue
      </button>
    </form>
  )
}
