/** @jsxImportSource hono/jsx/dom */
import type { Hex } from '@fuda/sdk'
import { ConfirmAction, ThemeToggle } from '@fuda/ui'
import type { ThemeMode } from '@fuda/ui'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { THEME_LABELS } from './copy.ts'

export const Settings = ({
  address,
  onSignOut,
  onTheme,
  theme,
}: {
  address: Hex
  onSignOut: () => void
  onTheme: (mode: ThemeMode) => void
  theme: ThemeMode
}): JSX.Element => (
  <main class="member-page member-page-narrow flex flex-col gap-6">
    <header>
      <p class="text-xs font-semibold tracking-widest text-[var(--fuda-muted)] uppercase">fuda · Member</p>
      <h1 class="member-heading mt-2">Settings</h1>
    </header>
    <section class="member-panel flex flex-col gap-4">
      <div>
        <div class="text-sm font-semibold">Connected address</div>
        <div class="mt-2 font-mono text-xs break-all">{address}</div>
      </div>
      <div class="flex items-center justify-between gap-4 border-t border-[var(--fuda-border)] pt-4">
        <span class="text-sm font-semibold">Appearance</span>
        <ThemeToggle labels={THEME_LABELS} mode={theme} onChange={onTheme} />
      </div>
    </section>
    <ConfirmAction
      cancelLabel="Keep session"
      confirmLabel="Sign out"
      description="This removes the member session from this browser. Passes saved on this device and your passkey remain."
      label="Sign out"
      title="Sign out of fuda?"
      onConfirm={onSignOut}
    />
  </main>
)
